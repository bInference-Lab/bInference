import { parseEvmAddress } from "@binference/chain-evm";
import { err, ok, type Result } from "@binference/core";

// Privy's `in` operator takes at most 100 values.
const maxListed = 100;

/** Why a list of recipients cannot go in a ceiling. */
export type AddressProblem = "malformed_address" | "too_many_addresses";

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
