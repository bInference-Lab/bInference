import { accountRefSchema, type ChainRef } from "@binference/chain";
import type { IdentityRegistry } from "@binference/chain/identity";
import { createErc8004Registry, erc8004Id } from "@binference/erc8004";
import type { ChainReads } from "./chain-reads.js";

/**
 * The identity registries an agent registers in (decisions 0334 and 0335): the ERC-8004 identity
 * registry on each chain whose registry entries list it, reading through that chain's failover.
 */
export function chainIdentityRegistries(
  reads: ReadonlyMap<ChainRef, Pick<ChainReads, "chain" | "rpc">>,
): readonly IdentityRegistry[] {
  return [...reads.values()].flatMap(({ chain, rpc }) => {
    const listed = chain.definition.contracts.filter(({ venue }) => venue === erc8004Id);
    const contracts = Object.fromEntries(
      listed.map(({ name, address }) => [name, accountRefSchema.parse(`${chain.ref}:${address}`)]),
    );
    return listed.length === 0 ? [] : [createErc8004Registry({ chain: chain.ref, rpc, contracts })];
  });
}
