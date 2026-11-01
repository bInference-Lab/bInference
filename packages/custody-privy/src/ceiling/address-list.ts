import { parseEvmAddress } from "@binference/chain-evm";
import { err, ok, type Result } from "@binference/core";
import type { ChainAddresses } from "./ceiling.js";

/** The most values Privy's `in` operator takes. */
export const maxListed = 100;

/** Why a list of recipients cannot go in a ceiling. */
export type AddressProblem = "malformed_address" | "too_many_addresses";

/**
 * The chain id a change signed before saved addresses named their chain carries: its addresses
 * stand for every chain, as they did then.
 */
export const anyChain = "*";

/**
 * The recipients a ceiling lists: checksummed, each once, in the order given, since Privy compares
 * strings case by case. More than 100 is `too_many_addresses`: Privy's `in` takes at most 100.
 */
export function addressList(texts: readonly string[]): Result<readonly string[], AddressProblem> {
  const listed = new Set<string>();
  for (const text of texts) {
    const address = parseEvmAddress(text);
    if (!address.ok) {
      return address;
    }
    listed.add(address.value);
  }
  return listed.size > maxListed ? err("too_many_addresses") : ok([...listed]);
}

/** The addresses the lists name for a chain: those listed for it, and those for every chain. */
export function addressesOn(lists: readonly ChainAddresses[], chainId: string): readonly string[] {
  return lists
    .filter((item) => item.chainId === chainId || item.chainId === anyChain)
    .flatMap((item) => item.addresses);
}
