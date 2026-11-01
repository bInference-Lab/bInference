import {
  type ChainDefinition,
  type ChainRef,
  chainRefSchema,
  createFamilyRegistry,
  type FamilyRegistry,
} from "@binference/chain";
import { createEvmAddressCodec } from "@binference/chain-evm";
import { createSolanaAddressCodec } from "@binference/chain-solana";
import {
  arbitrum,
  baseMainnet,
  bsc,
  bscBridgeRoutes,
  ethereum,
  robinhood,
  solana,
} from "@binference/chains";
import { type BridgePlan, ruleChainIds, ruleChainsOf } from "@binference/custody-privy";
import type { CeilingAddressParts } from "./ceiling-addresses.js";

/**
 * The chains a bridge delivers to from the chains this binference serves (decision 0297), where
 * the address book may save an address besides the wallets' chains.
 */
export function selfHostedDestinations(): readonly ChainDefinition[] {
  return [ethereum, baseMainnet, arbitrum, robinhood, solana];
}

/** The address codec of each chain family this binference reads (decision 0298). */
export function selfHostedFamilies(): FamilyRegistry {
  return createFamilyRegistry([createEvmAddressCodec(), createSolanaAddressCodec()]);
}

/**
 * How the engine's accounts become each ceiling's addresses (decision 0313): through each family's
 * codec, listed for the ids the rules bind on the chains given and on each chain a bridge delivers
 * to.
 */
export function selfHostedCeilingAddresses(
  chains: readonly ChainDefinition[],
): CeilingAddressParts {
  const definitions = [...chains, ...selfHostedDestinations()];
  return {
    families: selfHostedFamilies(),
    chainIdsOf: ruleChainIds(definitions),
    chainsOfId: ruleChainsOf(definitions),
  };
}

/**
 * What a ceiling on a chain this binference serves takes from the registry for its bridges
 * (decision 0302): the routes the bridges serve from it and the chains they reach; none for a
 * chain no bridge leaves from.
 */
export function selfHostedBridgePlan(chain: ChainRef): BridgePlan | undefined {
  return chain === chainRefSchema.parse(bsc.id)
    ? { routes: bscBridgeRoutes, destinations: selfHostedDestinations() }
    : undefined;
}
