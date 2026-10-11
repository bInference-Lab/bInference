import { err, ok, type Result } from "@binference/core";
import type { ChainRef } from "../caip/chain-ref.js";
import type { ChainDefinition } from "../registry/chain-definition.js";
import type { VenueDeclaration } from "./venue.js";

/**
 * The address of one contract a venue declares on a chain, read from the chain's registry entry by
 * the venue's id and the name; `unknown_contract` when the entry does not list it for the venue.
 */
export function declaredAddress(
  venue: Pick<VenueDeclaration, "id">,
  chain: { readonly definition: ChainDefinition },
  name: string,
): Result<string, "unknown_contract"> {
  const found = chain.definition.contracts.find(
    (item) => item.venue === venue.id && item.name === name,
  );
  return found === undefined ? err("unknown_contract") : ok(found.address);
}

/**
 * The addresses of the contracts a venue declares on one chain, in the order it names them, read
 * from the chain's registry entry by the venue's id and each name. A chain the venue declares
 * nothing on gives none; a name the entry does not list for the venue is `unknown_contract`, so a
 * caller never allows less, or more, than the venue uses.
 */
export function declaredContracts(
  venue: VenueDeclaration,
  chain: { readonly ref: ChainRef; readonly definition: ChainDefinition },
): Result<readonly string[], "unknown_contract"> {
  const names = venue.contracts.find((item) => item.chain === chain.ref)?.names ?? [];
  const addresses: string[] = [];
  for (const name of names) {
    const found = declaredAddress(venue, chain, name);
    if (!found.ok) {
      return found;
    }
    addresses.push(found.value);
  }
  return ok(addresses);
}
