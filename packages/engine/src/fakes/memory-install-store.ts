import { err, type Id, ok, type Result } from "@binference/core";
import type { InstallFacts, InstallSetup, WalletRecord } from "../install/install-record.js";
import type { RescueMove } from "../install/rescue-record.js";
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
    ...withRescue(state, { rescueAddress: setup.rescueAddress }),
    custody: setup.custody,
    wallets: [...archived, setup.wallet],
  });
}

// The state with its rescue address and the one that waits replaced by `rescue`.
function withRescue(state: InstallState, rescue: RescueState): InstallState {
  const { installId, custody, wallets } = state;
  return {
    ...(installId === undefined ? {} : { installId }),
    ...(custody === undefined ? {} : { custody }),
    ...rescue,
    wallets,
  };
}

// The rescue state a rule decides at `atMs`, written as the SQLite store's one transaction does.
function movedRescue(
  state: InstallState,
  atMs: number,
  decide: (rescue: RescueState) => RescueState,
): { readonly state: InstallState; readonly move: RescueMove } {
  const after = decide(state);
  return { state: withRescue(state, after), move: { before: rescueAt(state, atMs), after } };
}

/** The in-memory install store, which also takes wallets a test adds. */
export interface MemoryInstallStore extends InstallStore {
  /** Adds a wallet as if a setup had stored it; wallets stay oldest first. */
  addWallet(wallet: WalletRecord): void;
}

/** Creates an empty in-memory {@link InstallStore} for tests. */
export function createMemoryInstallStore(): MemoryInstallStore {
  const held: { state: InstallState } = { state: { wallets: [] } };
  const write = (atMs: number, decide: (rescue: RescueState) => RescueState): RescueMove => {
    const moved = movedRescue(held.state, atMs, decide);
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
    read: async (call) =>
      memoryCall(call, () => {
        const { custody, rescueAddress, pendingRescue, wallets } = held.state;
        return structuredClone({
          ...(custody === undefined ? {} : { custody }),
          ...(rescueAddress === undefined ? {} : { rescueAddress }),
          ...(pendingRescue === undefined ? {} : { pendingRescue }),
          wallets,
        });
      }),
    setUp: async (setup, call) =>
      memoryCall(call, () => {
        const next = setUp(held.state, structuredClone(setup));
        if (!next.ok) {
          return next;
        }
        held.state = next.value;
        return ok(undefined);
      }),
    changeRescue: async ({ address, atMs }, call) =>
      memoryCall(call, () => write(atMs, (rescue) => changeRescue(rescue, address, atMs))),
    cancelRescueChange: async (atMs, call) =>
      memoryCall(call, () => write(atMs, (rescue) => cancelRescue(rescue, atMs))),
  };
}
