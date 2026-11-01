import { acrossDeclaration, type AcrossRoute, createAcrossBridge } from "@binference/across";
import {
  availableRoutesAnswer,
  recipientOn,
  recordedApi,
  requestFor,
  tokens,
} from "@binference/across/testing";
import {
  type AssetRef,
  assetRefSchema,
  type ChainDefinition,
  chainRefSchema,
} from "@binference/chain";
import { evmChainOf } from "@binference/chain-evm";
import { bsc, bscBridgeRoutes, bscVenueCalls } from "@binference/chains";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { selfHostedDestinations } from "./self-hosted-destinations.js";

const bscRef = chainRefSchema.parse(bsc.id);
const destinations = selfHostedDestinations();
const live = { signal: new AbortController().signal };

function tokenOf(definition: ChainDefinition, symbol: string): AssetRef {
  const token = definition.tokens.find((item) => item.symbol === symbol);
  return assetRefSchema.parse(`${definition.id}/erc20:${getAddress(token?.address ?? "")}`);
}

function decimalsOf(definition: ChainDefinition, symbol: string): number {
  return definition.tokens.find((item) => item.symbol === symbol)?.decimals ?? -1;
}

function destinationOf(key: string): ChainDefinition {
  const found = destinations.find((item) => item.key === key);
  if (found === undefined) {
    throw new Error(`No destination ${key}.`);
  }
  return found;
}

// The registry's Across routes as the bridge takes them, with the registry's decimals: a token that
// arrives as the destination's wrapped coin names that coin, which the bridge asks for.
function routeOf(route: (typeof bscBridgeRoutes)[number]): AcrossRoute {
  const destination = destinationOf(route.to);
  const { assetNamespace, assetReference, symbol } = destination.nativeAsset;
  const coin = assetRefSchema.parse(`${destination.id}/${assetNamespace}:${assetReference}`);
  const decimals = {
    leaves: decimalsOf(bsc, route.leaves),
    arrives: decimalsOf(destination, route.arrives),
  };
  const leaves = tokenOf(bsc, route.leaves);
  const arrives = tokenOf(destination, route.arrives);
  return route.arrives === `W${symbol}`
    ? { leaves, arrives, decimals, coin }
    : { leaves, arrives, decimals };
}

const registryRoutes: readonly AcrossRoute[] = bscBridgeRoutes
  .filter((route) => route.venue === "across")
  .map(routeOf);

const routesSchema = z.array(
  z.looseObject({
    originChainId: z.literal(56),
    originToken: z.string(),
    destinationChainId: z.int(),
    destinationToken: z.string(),
  }),
);

// The pairs Across's recorded answer lists from BSC to a Q3 chain, between registry tokens.
function listedPairs(): ReadonlySet<string> {
  const evm = destinations.filter((item) => item.family === "evm");
  const routes = routesSchema.parse(JSON.parse(availableRoutesAnswer));
  return new Set(
    routes.flatMap((route) => {
      const destination = evm.find((item) => evmChainOf(item).chainId === route.destinationChainId);
      const leaves = bsc.tokens.find(
        (item) => getAddress(item.address) === getAddress(route.originToken),
      );
      const arrives = destination?.tokens.find(
        (item) => getAddress(item.address) === getAddress(route.destinationToken),
      );
      return destination === undefined || leaves === undefined || arrives === undefined
        ? []
        : [`${tokenOf(bsc, leaves.symbol)} ${tokenOf(destination, arrives.symbol)}`];
    }),
  );
}

describe("the across bridge in this binference", () => {
  it("declares exactly the calls and spender the registry lists for Across on BNB Smart Chain", () => {
    expect(acrossDeclaration([bscRef]).contracts).toStrictEqual([bscVenueCalls["across"]]);
  });

  it("serves the routes Across's API listed from BSC to the Q3 chains, as the registry does", () => {
    const registry = new Set(registryRoutes.map((route) => `${route.leaves} ${route.arrives}`));
    expect(registry).toStrictEqual(listedPairs());
    expect(registry.size).toBe(10);
  });

  it("names the coin of the ETH routes, which arrive wrapped, and of no other", () => {
    const wrapped = registryRoutes.filter((route) => route.coin !== undefined);
    expect(wrapped.map((route) => route.leaves)).toStrictEqual(Array(4).fill(tokens.eth));
    expect(wrapped.map((route) => route.coin)).toStrictEqual([
      "eip155:1/slip44:60",
      "eip155:8453/slip44:60",
      "eip155:42161/slip44:60",
      "eip155:4663/slip44:60",
    ]);
  });

  it("takes each route's decimals from the registry, as Across's answers name them", () => {
    expect(registryRoutes.map((route) => route.decimals)).toContainEqual({
      leaves: 18,
      arrives: 6,
    });
    expect(registryRoutes.every((route) => route.decimals.leaves === 18)).toBe(true);
  });

  it("lists no Across route to Solana, which its API serves from no BSC route", () => {
    const routes = routesSchema.parse(JSON.parse(availableRoutesAnswer));
    expect(routes.some((route) => route.destinationChainId === 34_268_394_551_451)).toBe(false);
    const acrossRoutes = bscBridgeRoutes.filter((route) => route.venue === "across");
    expect(acrossRoutes.map((route) => route.to)).not.toContain("solana");
  });

  it("quotes no route Across lists that the registry leaves out, such as Base's USDbC, and asks nothing", async () => {
    const http = recordedApi();
    const bridge = createAcrossBridge({ http, chains: [bscRef], routes: registryRoutes });
    const usdbc = assetRefSchema.parse(
      "eip155:8453/erc20:0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
    );
    const request = {
      ...requestFor(tokens.usdc, usdbc),
      recipient: recipientOn(chainRefSchema.parse("eip155:8453")),
    };
    await expect(bridge.quote(request, live)).resolves.toStrictEqual({
      ok: false,
      error: "no_route",
    });
    expect(http.requests()).toStrictEqual([]);
  });

  it("quotes the registry's USDC route to Base through the recorded answer", async () => {
    const bridge = createAcrossBridge({
      http: recordedApi(),
      chains: [bscRef],
      routes: registryRoutes,
    });
    await expect(
      bridge.quote(requestFor(tokens.usdc, tokens.baseUsdc), live),
    ).resolves.toMatchObject({
      ok: true,
    });
  });
});
