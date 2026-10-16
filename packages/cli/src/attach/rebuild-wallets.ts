import type { OwnedWallet } from "@binference/custody-privy";

/**
 * The wallets a rebuild adopts, in the order it records them (decision 0218): every agent wallet
 * as Privy listed them, so the default wallet is never a launch wallet, then every launch wallet,
 * the newest by Privy's time first, which becomes the agent's launch wallet; the others are extra
 * launch wallets the owner rescues. `undefined` when the owner key owns no agent wallet: a rebuild
 * needs one for the agent's default wallet.
 */
export function rebuildOrder(owned: readonly OwnedWallet[]): readonly OwnedWallet[] | undefined {
  const agents = owned.filter((item) => !item.ceiling.isLaunch);
  const launches = owned
    .filter((item) => item.ceiling.isLaunch)
    .toSorted((left, right) => right.wallet.createdAtMs - left.wallet.createdAtMs);
  return agents.length === 0 ? undefined : [...agents, ...launches];
}
