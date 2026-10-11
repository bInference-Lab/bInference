import { err, ok, type Result } from "@binference/core";
import type { ChainRef } from "../caip/chain-ref.js";
import type { ChainDefinition } from "../registry/chain-definition.js";
import type { VenueDeclaration } from "./venue.js";

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
    const found = chain.definition.contracts.find(
      (item) => item.venue === venue.id && item.name === name,
    );
    if (found === undefined) {
      return err("unknown_contract");
    }
    addresses.push(found.address);
  }
  return ok(addresses);
}
