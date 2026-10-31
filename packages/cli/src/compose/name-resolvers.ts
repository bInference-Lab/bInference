import { accountRefSchema, type ChainRef, type NameResolver } from "@binference/chain";
import { createSpaceIdResolver } from "@binference/spaceid";
import type { ChainReads } from "./chain-reads.js";

// The venue under which the chain registry lists SPACE ID's registry and base registrar.
const spaceIdVenue = "spaceid";

/**
 * The name resolvers the engine asks for `name/resolve` and sends by name: SPACE ID's `.bnb`
 * resolver on each chain whose registry entries list SPACE ID's contracts, reading through that
 * chain's failover.
 */
export function chainNameResolvers(
  reads: ReadonlyMap<ChainRef, Pick<ChainReads, "chain" | "rpc">>,
): readonly NameResolver[] {
  return [...reads.values()].flatMap(({ chain, rpc }) => {
    const listed = chain.definition.contracts.filter(({ venue }) => venue === spaceIdVenue);
    const contracts = Object.fromEntries(
      listed.map(({ name, address }) => [name, accountRefSchema.parse(`${chain.ref}:${address}`)]),
    );
    return listed.length === 0 ? [] : [createSpaceIdResolver({ chain: chain.ref, rpc, contracts })];
  });
}
