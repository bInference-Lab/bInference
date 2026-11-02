import {
  type AccountRef,
  accountRefSchema,
  type ChainRef,
  type RatePriceDefinition,
} from "@binference/chain";
import { erc20AssetRef, parseEvmAddress } from "@binference/chain-evm";
import type { StakingVenue } from "@binference/chain/staking";
import { createListaVenue, listaId, stakeManagerName } from "@binference/lista";
import { createStakeHubVenue, stakeHubId } from "@binference/stakehub";
import type { ChainReads } from "./chain-reads.js";

type StakingReads = Pick<ChainReads, "chain" | "evm" | "rpc" | "multicall">;

// The contracts the registry lists on the chain for a venue, by their registry names.
function contractsOf(read: StakingReads, venue: string): Readonly<Record<string, AccountRef>> {
  const { chain } = read;
  const listed = chain.definition.contracts.filter((item) => item.venue === venue);
  return Object.fromEntries(
    listed.map(({ name, address }) => [name, accountRefSchema.parse(`${chain.ref}:${address}`)]),
  );
}

function stakeHubOn(read: StakingReads): readonly StakingVenue[] {
  const contracts = contractsOf(read, stakeHubId);
  if (Object.keys(contracts).length === 0) {
    return [];
  }
  const { chain, evm, rpc, multicall } = read;
  const venue = { chain: chain.ref, coin: evm.nativeAsset, rpc, contracts };
  return [createStakeHubVenue({ ...venue, multicall: accountOf(read, multicall) })];
}

function accountOf(read: StakingReads, address: string): AccountRef {
  return accountRefSchema.parse(`${read.chain.ref}:${address}`);
}

// Lista, where the registry lists its stake manager, StakeHub, whose unbonding time Lista's queue
// waits at least, and the token the registry prices at the stake manager's rate, slisBNB.
function listaOn(
  read: StakingReads,
  rates: readonly RatePriceDefinition[],
): readonly StakingVenue[] {
  const { chain, evm, rpc, multicall } = read;
  const lista = contractsOf(read, listaId);
  const stakeHub = contractsOf(read, stakeHubId)["stake-hub"];
  const priced = rates.find(
    ({ venue, contract }) => venue === listaId && contract === stakeManagerName,
  );
  const token = chain.definition.tokens.find(({ symbol }) => symbol === priced?.symbol);
  const address = token === undefined ? undefined : parseEvmAddress(token.address);
  if (lista[stakeManagerName] === undefined || stakeHub === undefined || address?.ok !== true) {
    return [];
  }
  const receipt = erc20AssetRef(evm, address.value);
  const venue = { chain: chain.ref, coin: evm.nativeAsset, receipt, rpc, contracts: lista };
  return [createListaVenue({ ...venue, stakeHub, multicall: accountOf(read, multicall) })];
}

/**
 * The staking venues of this binference: StakeHub on each chain whose registry entries list its
 * contracts, and Lista on each that lists its stake manager, StakeHub and the token it prices at
 * the stake manager's rate (decisions 0324 and 0332), each reading through that chain's failover
 * and Multicall3 and staking its coin. The engine plans, builds and decodes stakes through them.
 */
export function chainStakingVenues(
  reads: ReadonlyMap<ChainRef, StakingReads>,
  rates: ReadonlyMap<ChainRef, readonly RatePriceDefinition[]> = new Map(),
): readonly StakingVenue[] {
  return [...reads.values()].flatMap((read) =>
    stakeHubOn(read).concat(listaOn(read, rates.get(read.chain.ref) ?? [])),
  );
}
