import { err, type Id, ok, type Result } from "@binference/core";
import type { InstallFacts, InstallSetup, WalletRecord } from "../install/install-record.js";
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
    ...state,
    custody: setup.custody,
    rescueAddress: setup.rescueAddress,
    wallets: [...archived, setup.wallet],
  });
}

/** Creates an empty in-memory {@link InstallStore} for tests. */
export function createMemoryInstallStore(): InstallStore {
  const held: { state: InstallState } = { state: { wallets: [] } };
  return {
    installId: async (proposal, call) =>
      memoryCall(call, () => {
        const installId = held.state.installId ?? proposal.id;
        held.state = { ...held.state, installId };
        return installId;
      }),
    read: async (call) =>
      memoryCall(call, () => {
        const { custody, rescueAddress, wallets } = held.state;
        return structuredClone({
          ...(custody === undefined ? {} : { custody }),
          ...(rescueAddress === undefined ? {} : { rescueAddress }),
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
  };
}
