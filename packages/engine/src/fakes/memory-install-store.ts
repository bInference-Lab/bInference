import { err, type Id, ok, type Result } from "@binference/core";
import type { InstallFacts, InstallSetup, WalletRecord } from "../install/install-record.js";
import {
  type RescueCancel,
  type RescueCeiling,
  rescueCeilingAfter,
  type RescueMove,
} from "../install/rescue-record.js";
import { cancelRescue, changeRescue, type RescueState, rescueAt } from "../policy/rescue-change.js";
import type { InstallStore } from "../ports.js";
import { constraintFault, memoryCall } from "./memory-call.js";

/** What the fake holds: the install's facts and its id. */
interface InstallState extends InstallFacts {
  readonly installId?: Id<"ins">;
}

function isHeld(wallets: readonly WalletRecord[], setup: InstallSetup): boolean {
  const { wallet } = setup;
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
  if (isHeld(state.wallets, setup)) {
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
  const { installId, custody, wallets } = state;
  return {
    ...(installId === undefined ? {} : { installId }),
    ...(custody === undefined ? {} : { custody }),
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
  const { custody, rescueCeiling, wallets } = state;
  return {
    ...(custody === undefined ? {} : { custody }),
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

/** The in-memory install store, which also takes wallets a test adds. */
export interface MemoryInstallStore extends InstallStore {
  /** Adds a wallet as if a setup had stored it; wallets stay oldest first. */
  addWallet(wallet: WalletRecord): void;
}

/** Creates an empty in-memory {@link InstallStore} for tests. */
export function createMemoryInstallStore(): MemoryInstallStore {
  const held: { state: InstallState } = { state: { wallets: [] } };
  const write = (rescueWrite: RescueWrite): RescueCancel => {
    const moved = movedRescue(held.state, rescueWrite);
    held.state = moved.state;
    return structuredClone(moved.move);
  };
  return {
    addWallet(wallet) {
      const wallets = [...held.state.wallets, structuredClone(wallet)];
      held.state = {
        ...held.state,
        wallets: wallets.toSorted((a, b) => a.createdAtMs - b.createdAtMs),
      };
    },
    installId: async (proposal, call) =>
      memoryCall(call, () => {
        const installId = held.state.installId ?? proposal.id;
        held.state = { ...held.state, installId };
        return installId;
      }),
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
    changeRescue: async ({ address, atMs, ceiling }, call) =>
      memoryCall(call, (): RescueMove => {
        const decide = (rescue: RescueState): RescueState => changeRescue(rescue, address, atMs);
        const { before, after } = write({
          atMs,
          decide,
          ...(ceiling === undefined ? {} : { asked: ceiling }),
        });
        return { before, after };
      }),
    cancelRescueChange: async (atMs, call) =>
      memoryCall(call, () => write({ atMs, decide: (rescue) => cancelRescue(rescue, atMs) })),
    clearRescueCeiling: async (call) =>
      memoryCall(call, () => {
        held.state = withRescue(held.state, storedRescue(held.state), undefined);
      }),
  };
}
