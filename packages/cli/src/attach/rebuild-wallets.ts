import type { ChainDefinition, VenueContracts, WalletRole } from "@binference/chain";
import type { OwnedWallet } from "@binference/custody-privy";

/** A wallet the owner key owns, with the role a rebuild reads from its ceiling. */
export type RebuildWallet = OwnedWallet & { readonly role?: WalletRole };

/**
 * The addresses, in lowercase, of the contracts only a bridge wallet calls or approves on a chain
 * (decision 0307): those of each call a venue there marks as a bridge wallet's, and of each spender
 * it lets only a bridge wallet approve, read from the chain definition by name.
 */
export function bridgeOnlyAddresses(
  definition: ChainDefinition,
  venues: Readonly<Record<string, VenueContracts>>,
): ReadonlySet<string> {
  const named = Object.entries(venues).flatMap(([venue, contracts]) =>
    [
      ...(contracts.calls ?? [])
        .filter((call) => call.onlyWallet === "bridge")
        .map((call) => call.contract),
      ...(contracts.onlyWalletSpenders?.bridge ?? []),
    ].map((name) => ({ venue, name })),
  );
  const addresses = named.flatMap(({ venue, name }) =>
    definition.contracts
      .filter((contract) => contract.venue === venue && contract.name === name)
      .map((contract) => contract.address.toLowerCase()),
  );
  return new Set(addresses);
}

/**
 * Each wallet's role, read from its ceiling (decisions 0218 and 0307): a launch wallet's holds a
 * launch rule; a bridge wallet's names a contract only a bridge wallet calls or approves, among
 * `bridgeOnly`; any other wallet is a main wallet.
 */
export function withRoles(
  owned: readonly OwnedWallet[],
  bridgeOnly: ReadonlySet<string>,
): readonly RebuildWallet[] {
  return owned.map((item) => {
    if (item.ceiling.isLaunch) {
      return { ...item, role: "launch" };
    }
    const isBridge = item.ceiling.contracts.some((address) =>
      bridgeOnly.has(address.toLowerCase()),
    );
    return isBridge ? { ...item, role: "bridge" } : item;
  });
}

// The wallets of one role, the newest by Privy's time first.
function newestOf(owned: readonly RebuildWallet[], role: WalletRole): readonly RebuildWallet[] {
  return owned
    .filter((item) => item.role === role)
    .toSorted((left, right) => right.wallet.createdAtMs - left.wallet.createdAtMs);
}

/**
 * The wallets a rebuild adopts, in the order it records them (decision 0218): every main wallet
 * as Privy listed them, so the default wallet never has a role, then every launch wallet and every
 * bridge wallet, each role's newest by Privy's time first, which becomes the agent's wallet of that
 * role; the others are extra ones the owner rescues. `undefined` when the owner key owns no main
 * wallet: a rebuild needs one for the agent's default wallet.
 */
export function rebuildOrder(
  owned: readonly RebuildWallet[],
): readonly RebuildWallet[] | undefined {
  const mains = owned.filter((item) => item.role === undefined);
  const roled = [...newestOf(owned, "launch"), ...newestOf(owned, "bridge")];
  return mains.length === 0 ? undefined : [...mains, ...roled];
}
