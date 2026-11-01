import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
  type ChainDefinition,
  type ChainRef,
} from "@binference/chain";
import { bsc, bscBridgeRoutes } from "@binference/chains";
import type { EngineOptions } from "@binference/engine";
import { getAddress } from "viem";
import { selfHostedDestinations } from "./self-hosted-destinations.js";

// A route as the engine and a bridge plugin take it.
type BridgeRoute = NonNullable<EngineOptions["bridges"]>[number]["routes"][number];

function tokenOf(definition: ChainDefinition, symbol: string): AssetRef | undefined {
  const token = definition.tokens.find((item) => item.symbol === symbol);
  return token === undefined
    ? undefined
    : assetRefSchema.parse(`${definition.id}/erc20:${getAddress(token.address)}`);
}

function decimalsOf(definition: ChainDefinition, symbol: string): number | undefined {
  return definition.tokens.find((item) => item.symbol === symbol)?.decimals;
}

// One registry route as a bridge serves it, with each token's decimals from the registry: a token
// that arrives as the destination's wrapped coin names that coin, which a fill pays a plain wallet.
function routeOf(route: (typeof bscBridgeRoutes)[number]): readonly BridgeRoute[] {
  const destination = selfHostedDestinations().find((item) => item.key === route.to);
  if (destination === undefined) {
    return [];
  }
  const leaves = tokenOf(bsc, route.leaves);
  const arrives = tokenOf(destination, route.arrives);
  const decimals = {
    leaves: decimalsOf(bsc, route.leaves),
    arrives: decimalsOf(destination, route.arrives),
  };
  if (
    leaves === undefined ||
    arrives === undefined ||
    decimals.leaves === undefined ||
    decimals.arrives === undefined
  ) {
    return [];
  }
  const { assetNamespace, assetReference, symbol } = destination.nativeAsset;
  const coin = assetRefSchema.parse(`${destination.id}/${assetNamespace}:${assetReference}`);
  const served = {
    leaves,
    arrives,
    decimals: { leaves: decimals.leaves, arrives: decimals.arrives },
  };
  return route.arrives === `W${symbol}` ? [{ ...served, coin }] : [served];
}

/**
 * The routes the registry lists for one bridge from BNB Smart Chain (decision 0301), each with its
 * tokens' decimals and, for a route that arrives as wrapped ETH, the coin a fill pays a plain
 * wallet. A route to a chain or of a token the registry does not list is left out.
 */
export function bridgeRoutesOf(venue: string): readonly BridgeRoute[] {
  return bscBridgeRoutes.filter((route) => route.venue === venue).flatMap(routeOf);
}

/**
 * A venue's contract of one name on BNB Smart Chain and on each chain bridges deliver to, as the
 * registry lists it, by chain: such as Across's SpokePool, whose events alone say a fill or refund
 * is a deposit's own (decision 0320). A chain that lists none is left out.
 */
export function bridgeContractsOf(
  venue: string,
  name: string,
): Readonly<Partial<Record<ChainRef, AccountRef>>> {
  return Object.fromEntries(
    [bsc, ...selfHostedDestinations()].flatMap((definition) => {
      const entry = definition.contracts.find((item) => item.venue === venue && item.name === name);
      return entry === undefined
        ? []
        : [
            [
              definition.id,
              accountRefSchema.parse(`${definition.id}:${getAddress(entry.address)}`),
            ],
          ];
    }),
  );
}
