import { err, type Id, ok, type Result } from "@binference/core";
import type {
  InstallFacts,
  InstallSetup,
  WalletDraft,
  WalletRecord,
} from "../install/install-record.js";
import {
  type RescueAddressChange,
  type RescueCancel,
  type RescueCeiling,
  rescueCeilingAfter,
  type RescueMove,
} from "../install/rescue-record.js";
import { cancelRescue, changeRescue, type RescueState, rescueAt } from "../policy/rescue-change.js";
import type { InstallStore } from "../ports.js";
import type { FreezeChange } from "./memory-agent-store.js";
import { byCreation, constraintFault, memoryCall } from "./memory-call.js";

/** What the fake holds: the install's facts and its id. */
interface InstallState extends InstallFacts {
  readonly installId?: Id<"ins">;
}

function isHeld(wallets: readonly WalletRecord[], wallet: WalletDraft): boolean {
  return wallets.some(
    (item) =>
      item.id === wallet.id ||
      item.custodyWalletId === wallet.custodyWalletId ||
      item.address === wallet.address,
  );
}

function setUp(state: InstallState, setup: InstallSetup): Result<InstallState, "set_up"> {
  if (state.custody !== undefined && !setup.isStartOver) {
    return err("set_up");
  }
  if (isHeld(state.wallets, setup.wallet)) {
    throw constraintFault("a wallet's id, Privy id or address is held already");
  }
  const archived = state.wallets.map((item) =>
    item.archivedAtMs === undefined ? { ...item, archivedAtMs: setup.atMs } : item,
  );
  return ok({
    ...withRescue(state, { rescueAddress: setup.rescueAddress }, undefined),
    custody: setup.custody,
    wallets: [...archived, setup.wallet],
  });
}

// The state with its rescue address, the one that waits and its ceiling changes replaced.
function withRescue(
  state: InstallState,
  rescue: RescueState,
  ceiling: RescueCeiling | undefined,
): InstallState {
  const { installId, custody, frozenAtMs, wallets } = state;
  return {
    ...(installId === undefined ? {} : { installId }),
    ...(custody === undefined ? {} : { custody }),
    ...(frozenAtMs === undefined ? {} : { frozenAtMs }),
    ...rescue,
    ...(ceiling === undefined ? {} : { rescueCeiling: ceiling }),
    wallets,
  };
}

/** A rule's rescue move at a time, and the ceiling changes a new address that waits comes with. */
interface RescueWrite {
  readonly atMs: number;
  readonly decide: (rescue: RescueState) => RescueState;
  readonly asked?: RescueCeiling;
}

// The rescue state a rule decides, written as the SQLite store's one transaction does.
function movedRescue(
  state: InstallState,
  { atMs, decide, asked }: RescueWrite,
): { readonly state: InstallState; readonly move: RescueCancel } {
  const move = { before: rescueAt(state, atMs), after: decide(state) };
  const stored = state.rescueCeiling;
  const ceiling = rescueCeilingAfter(move, {
    ...(stored === undefined ? {} : { stored }),
    ...(asked === undefined ? {} : { asked }),
  });
  const isDropped =
    move.before.pendingRescue !== undefined && move.after.pendingRescue === undefined;
  return {
    state: withRescue(state, move.after, ceiling),
    move: { ...move, ...(isDropped && stored !== undefined ? { dropped: stored } : {}) },
  };
}

// The install's facts as the store holds them, without the id.
function factsOf(state: InstallState): InstallFacts {
  const { custody, frozenAtMs, rescueCeiling, wallets } = state;
  return {
    ...(custody === undefined ? {} : { custody }),
    ...(frozenAtMs === undefined ? {} : { frozenAtMs }),
    ...storedRescue(state),
    ...(rescueCeiling === undefined ? {} : { rescueCeiling }),
    wallets,
  };
}

// The rescue address and the one that waits as stored, before any is settled.
function storedRescue(state: InstallState): RescueState {
  const { rescueAddress, pendingRescue } = state;
  return {
    ...(rescueAddress === undefined ? {} : { rescueAddress }),
    ...(pendingRescue === undefined ? {} : { pendingRescue }),
  };
}

// A new rescue address as the rule decides it, with the ceiling changes it comes with.
function rescueChange(
  write: (rescueWrite: RescueWrite) => RescueCancel,
  { address, atMs, ceiling }: RescueAddressChange,
): RescueMove {
  const decide = (rescue: RescueState): RescueState => changeRescue(rescue, address, atMs);
  const { before, after } = write({
    atMs,
    decide,
    ...(ceiling === undefined ? {} : { asked: ceiling }),
  });
  return { before, after };
}

// Wallets oldest first, as the SQLite store reads them.
function inOrder(wallets: readonly WalletRecord[]): readonly WalletRecord[] {
  return wallets.toSorted(byCreation);
}

// The state with a new wallet, refused as the SQLite store's unique columns refuse it.
function withWallet(state: InstallState, wallet: WalletDraft): InstallState {
  if (isHeld(state.wallets, wallet)) {
    throw constraintFault("a wallet's id, Privy id or address is held already");
  }
  return { ...state, wallets: inOrder([...state.wallets, wallet]) };
}

// The state with the ceiling changes signed again for the new rescue address that waits.
function withKept(state: InstallState, ceiling: RescueCeiling): InstallState {
  return state.pendingRescue === undefined
    ? state
    : withRescue(state, storedRescue(state), ceiling);
}

/**
 * The in-memory install store, which also takes wallets a test adds and holds the install's freeze
 * the in-memory intent store writes.
 */
export interface MemoryInstallStore extends InstallStore {
  /** Adds a wallet as if a setup had stored it; wallets stay oldest first. */
  addWallet(wallet: WalletRecord): void;
  /**
   * Marks the install frozen at `atMs` inside another store's write, keeping an earlier time, or
   * clears its freeze.
   */
  freezeNow(change: FreezeChange): void;
  /** When the whole install was frozen, or `undefined` while it is not. */
  frozenAt(): number | undefined;
}

/** Creates an empty in-memory {@link InstallStore} for tests. */
export function createMemoryInstallStore(): MemoryInstallStore {
  const held: { state: InstallState } = { state: { wallets: [] } };
  const update = (change: (state: InstallState) => InstallState): void => {
    held.state = change(held.state);
  };
  const write = (rescueWrite: RescueWrite): RescueCancel => {
    const moved = movedRescue(held.state, rescueWrite);
    held.state = moved.state;
    return structuredClone(moved.move);
  };
  return {
    addWallet(wallet) {
      update((state) => ({
        ...state,
        wallets: inOrder([...state.wallets, structuredClone(wallet)]),
      }));
    },
    installId: async (proposal, call) =>
      memoryCall(call, () => {
        const installId = held.state.installId ?? proposal.id;
        held.state = { ...held.state, installId };
        return installId;
      }),
    freezeNow({ atMs, isFrozen }) {
      const { frozenAtMs, ...rest } = held.state;
      const at = isFrozen ? (frozenAtMs ?? atMs) : undefined;
      held.state = { ...rest, ...(at === undefined ? {} : { frozenAtMs: at }) };
    },
    frozenAt: () => held.state.frozenAtMs,
    read: async (call) => memoryCall(call, () => structuredClone(factsOf(held.state))),
    setUp: async (setup, call) =>
      memoryCall(call, () => {
        const next = setUp(held.state, structuredClone(setup));
        if (!next.ok) {
          return next;
        }
        held.state = next.value;
        return ok(undefined);
      }),
    changeRescue: async (change, call) => memoryCall(call, () => rescueChange(write, change)),
    cancelRescueChange: async (atMs, call) =>
      memoryCall(call, () => write({ atMs, decide: (rescue) => cancelRescue(rescue, atMs) })),
    clearRescueCeiling: async (call) =>
      memoryCall(call, () => update((state) => withRescue(state, storedRescue(state), undefined))),
    keepRescueCeiling: async (ceiling, call) =>
      memoryCall(call, () => update((state) => withKept(state, structuredClone(ceiling)))),
    createWallet: async (wallet, call) =>
      memoryCall(call, () => update((state) => withWallet(state, structuredClone(wallet)))),
  };
}
