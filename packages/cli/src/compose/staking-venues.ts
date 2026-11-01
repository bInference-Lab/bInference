import { accountRefSchema, type ChainRef } from "@binference/chain";
import type { StakingVenue } from "@binference/chain/staking";
import { createStakeHubVenue, stakeHubId } from "@binference/stakehub";
import type { ChainReads } from "./chain-reads.js";

/**
 * The staking venues of this binference: StakeHub on each chain whose registry entries list its
 * contracts, reading through that chain's failover and Multicall3 and staking its coin. The engine
 * plans, builds and decodes stakes through them.
 */
export function chainStakingVenues(
  reads: ReadonlyMap<ChainRef, Pick<ChainReads, "chain" | "evm" | "rpc" | "multicall">>,
): readonly StakingVenue[] {
  return [...reads.values()].flatMap(({ chain, evm, rpc, multicall }) => {
    const listed = chain.definition.contracts.filter(({ venue }) => venue === stakeHubId);
    if (listed.length === 0) {
      return [];
    }
    const accountOf = (address: string) => accountRefSchema.parse(`${chain.ref}:${address}`);
    const contracts = Object.fromEntries(
      listed.map(({ name, address }) => [name, accountOf(address)]),
    );
    const coin = evm.nativeAsset;
    const venue = { chain: chain.ref, coin, rpc, contracts, multicall: accountOf(multicall) };
    return [createStakeHubVenue(venue)];
  });
}
