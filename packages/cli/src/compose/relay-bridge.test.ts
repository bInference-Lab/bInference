import {
  type AssetRef,
  assetRefParts,
  type ChainDefinition,
  chainRefSchema,
} from "@binference/chain";
import { bsc, bscBridgeRoutes, bscVenueCalls } from "@binference/chains";
import { relayDeclaration } from "@binference/relay";
import {
  depository,
  recordedChainsAnswer,
  recordedRobinhoodQuotes,
  tokens,
} from "@binference/relay/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bridgeContractsOf, bridgeRoutesOf } from "./bridge-routes.js";
import { selfHostedDestinations } from "./self-hosted-destinations.js";

const bscRef = chainRefSchema.parse(bsc.id);
const registryRoutes = bridgeRoutesOf("relay");
const pairOf = (leaves: AssetRef, arrives: AssetRef): string => `${leaves} ${arrives}`;

const currencySchema = z.looseObject({
  id: z.string(),
  address: z.string(),
  supportsBridging: z.boolean(),
});
const chainsSchema = z.looseObject({
  chains: z.array(
    z.looseObject({
      id: z.int(),
      protocol: z.looseObject({ v2: z.looseObject({ chainId: z.string() }) }),
      erc20Currencies: z.array(currencySchema),
    }),
  ),
});
const quoteSchema = z.looseObject({
  details: z.looseObject({
    currencyIn: z.looseObject({ currency: z.looseObject({ address: z.string() }) }),
    currencyOut: z.looseObject({
      currency: z.looseObject({ chainId: z.int(), address: z.string() }),
    }),
  }),
});

// A registry token of a chain by the address Relay writes, any case on an EVM chain.
function registryToken(definition: ChainDefinition, address: string): AssetRef | undefined {
  const isEvm = definition.family === "evm";
  const token = definition.tokens.find((item) =>
    isEvm ? item.address.toLowerCase() === address.toLowerCase() : item.address === address,
  );
  const route = registryRoutes.find(
    (item) =>
      assetRefParts(item.arrives).assetReference.toLowerCase() === token?.address.toLowerCase(),
  );
  return route?.arrives;
}

const relayIdOf = (definition: ChainDefinition): number | undefined =>
  definition.family === "solana" ? 792_703_809 : Number(definition.id.split(":")[1]);

// The pairs Relay's recorded chains answer bridges from BSC to a destination: a currency both chains
// list as bridging, between registry tokens; and the USDG fills its recorded quotes gave.
function listedPairs(): ReadonlySet<string> {
  const { chains } = chainsSchema.parse(JSON.parse(recordedChainsAnswer));
  const bridging = (id: number) =>
    chains
      .find((chain) => chain.id === id)
      ?.erc20Currencies.filter((item) => item.supportsBridging) ?? [];
  const fromBsc = bridging(56);
  const paired = selfHostedDestinations().flatMap((definition) =>
    bridging(relayIdOf(definition) ?? 0).flatMap((currency) => {
      const leaves = fromBsc.find((item) => item.id === currency.id);
      const arrives = registryToken(definition, currency.address);
      const sent = registryRoutes.find(
        (route) =>
          assetRefParts(route.leaves).assetReference.toLowerCase() ===
          leaves?.address.toLowerCase(),
      );
      return sent === undefined || arrives === undefined ? [] : [pairOf(sent.leaves, arrives)];
    }),
  );
  const quoted = recordedRobinhoodQuotes.map((text) => {
    const { currencyIn, currencyOut } = quoteSchema.parse(JSON.parse(text)).details;
    const sent = registryRoutes.find(
      (route) =>
        assetRefParts(route.leaves).assetReference.toLowerCase() ===
        currencyIn.currency.address.toLowerCase(),
    );
    const arrives = registryRoutes.find(
      (route) =>
        assetRefParts(route.arrives).assetReference.toLowerCase() ===
        currencyOut.currency.address.toLowerCase(),
    );
    return sent === undefined || arrives === undefined ? "" : pairOf(sent.leaves, arrives.arrives);
  });
  return new Set([...paired, ...quoted]);
}

describe("the relay bridge in this binference", () => {
  it("declares exactly the calls and spender the registry lists for Relay on BNB Smart Chain", () => {
    expect(relayDeclaration([bscRef]).contracts).toStrictEqual([bscVenueCalls["relay"]]);
  });

  it("serves the routes Relay's API listed from BSC to the Q3 chains, as the registry does", () => {
    const registry = new Set(registryRoutes.map((route) => pairOf(route.leaves, route.arrives)));
    expect(registry).toStrictEqual(listedPairs());
    expect(registry.size).toBe(10);
  });

  it("names each Solana route's token by its mint, and no route's coin", () => {
    const toSolana = registryRoutes.filter((route) => route.arrives.startsWith("solana:"));
    expect(toSolana.map((route) => route.arrives)).toContain(tokens.solanaUsdc);
    expect(toSolana).toHaveLength(2);
    expect(registryRoutes.every((route) => route.coin === undefined)).toBe(true);
  });

  it("caps the swap's rate at 50 basis points on the routes that arrive as USDG, and on no other", () => {
    const capped = registryRoutes.filter((route) => route.swapCapBps !== undefined);
    expect(capped.map((route) => [route.arrives, route.swapCapBps])).toStrictEqual([
      [tokens.robinhoodUsdg, 50],
      [tokens.robinhoodUsdg, 50],
    ]);
  });

  it("names each chain as Relay's chains answer does: its id and its order name", () => {
    const { chains } = chainsSchema.parse(JSON.parse(recordedChainsAnswer));
    const names = Object.fromEntries(chains.map((chain) => [chain.id, chain.protocol.v2.chainId]));
    expect(names).toStrictEqual({
      1: "ethereum",
      56: "bnb",
      4663: "robinhood",
      8453: "base",
      42161: "arbitrum",
      792703809: "solana",
    });
  });

  it("lists Relay's depository on BSC alone, as Relay's addresses page does", () => {
    expect(bridgeContractsOf("relay", "depository")).toStrictEqual({ [bscRef]: depository });
    expect(bscBridgeRoutes.filter((route) => route.venue === "relay")).toHaveLength(10);
  });
});
