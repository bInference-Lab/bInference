import { type AccountRef, accountRefParts, type ChainRegistry } from "@binference/chain";
import type { Id } from "@binference/core";
import type { InstallStore } from "../ports.js";
import type { WalletRecord } from "./install-record.js";

/**
 * The agent's live launch wallet among the install's wallets (decision 0217): the first the store
 * lists; `undefined` when it has none. Only a rebuild leaves an agent more than one, and nothing
 * trades from the others (decision 0218).
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

/**
 * Whether the account is the address of a live launch wallet of any agent of the install, on a
 * chain of the wallet's family (decision 0218): no ceiling may list one, so the agent's other
 * wallets can never pay it. An account on a chain the registry lacks is none.
 */
export function isLaunchWalletAccount(
  wallets: readonly WalletRecord[],
  account: AccountRef,
  chains: ChainRegistry,
): boolean {
  const { chain, address } = accountRefParts(account);
  const registered = chains.get(chain);
  if (!registered.ok) {
    return false;
  }
  const { family, definition } = registered.value;
  const typed = family.parseAddress(address);
  return wallets.some((wallet) => {
    const own = family.parseAddress(wallet.address);
    const isLive = wallet.role === "launch" && wallet.archivedAtMs === undefined;
    return isLive && wallet.family === definition.family && own.ok && typed.ok
      ? own.value === typed.value
      : false;
  });
}
