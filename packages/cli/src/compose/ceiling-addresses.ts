import {
  type AccountRef,
  accountRefParts,
  type ChainRef,
  type FamilyRegistry,
  recipientBytesOf,
} from "@binference/chain";
import type { ChainAddresses } from "@binference/custody-privy";

/** How the accounts the engine names become the addresses a ceiling lists per chain. */
export interface CeilingAddressParts {
  /** The address codec of each CAIP-2 namespace, which gives each account its recipient bytes. */
  readonly families: FamilyRegistry;
  /** The ids a ceiling's rules bind for a chain; none for a chain no rule pays on. */
  readonly chainIdsOf: (chain: ChainRef) => readonly string[];
}

/**
 * Each account's recipient bytes, listed for each id its chain's rules bind, in the order given
 * (decision 0313): an address saved for Base is listed for Base alone, so a send on BNB Smart
 * Chain never pays it and a bridge to Base may. An account on a chain no rule pays on, such as
 * Solana while no venue declares a deposit there, or one its family cannot read, is listed nowhere.
 */
export function ceilingAddressesOf(
  accounts: readonly AccountRef[],
  parts: CeilingAddressParts,
): readonly ChainAddresses[] {
  const lists = new Map<string, string[]>();
  for (const account of accounts) {
    const bytes = recipientBytesOf(parts.families, account);
    const ids = bytes.ok ? parts.chainIdsOf(accountRefParts(account).chain) : [];
    for (const id of ids) {
      const listed = lists.get(id) ?? [];
      lists.set(id, [...listed, ...(bytes.ok ? [bytes.value] : [])]);
    }
  }
  return [...lists].map(([chainId, addresses]) => ({
    chainId,
    addresses: [...new Set(addresses)],
  }));
}
