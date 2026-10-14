import type { Id } from "@binference/core";
import type { InstallStore } from "../ports.js";
import type { WalletRecord } from "./install-record.js";

/**
 * The agent's live launch wallet among the install's wallets (decision 0217); `undefined` when it
 * has none. An agent holds one at most.
 */
export function launchWalletIn(
  wallets: readonly WalletRecord[],
  agent: Id<"agt">,
): WalletRecord | undefined {
  return wallets.find(
    (wallet) =>
      wallet.agentId === agent && wallet.role === "launch" && wallet.archivedAtMs === undefined,
  );
}

/** The agent's live launch wallet as the install store holds it now; `undefined` for none. */
export async function launchWalletOf(
  install: Pick<InstallStore, "read">,
  agent: Id<"agt">,
  options: { readonly signal: AbortSignal },
): Promise<WalletRecord | undefined> {
  const { wallets } = await install.read(options);
  return launchWalletIn(wallets, agent);
}
