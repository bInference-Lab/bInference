import type { ChainDefinition } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { arbitrum } from "../arbitrum.js";
import { baseMainnet } from "../base-mainnet.js";
import { bsc } from "../bsc.js";
import { ethereum } from "../ethereum.js";
import { robinhood } from "../robinhood.js";
import { solana } from "../solana.js";
import { bscBridgeRoutes } from "./bsc-bridge-routes.js";

const destinations: readonly ChainDefinition[] = [
  ethereum,
  baseMainnet,
  arbitrum,
  robinhood,
  solana,
];
const byKey = new Map(destinations.map((chain) => [chain.key, chain]));
const symbolsOf = (chain: ChainDefinition | undefined): readonly string[] =>
  chain?.tokens.map(({ symbol }) => symbol) ?? [];

describe("the bridge routes from BSC", () => {
  it.each(bscBridgeRoutes)(
    "names registry tokens on both chains: $venue $leaves to $to as $arrives",
    ({ leaves, to, arrives }) => {
      expect(symbolsOf(bsc)).toContain(leaves);
      expect(symbolsOf(byKey.get(to))).toContain(arrives);
    },
  );

  it.each(bscBridgeRoutes)(
    "cites the bridge's own API for $venue to $to",
    ({ source, checkedOn }) => {
      expect(source).toMatch(/^https:\/\/(?:app\.across\.to|api\.relay\.link)\//);
      expect(checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    },
  );

  it("lists each route once", () => {
    const keys = bscBridgeRoutes.map(
      ({ venue, leaves, to, arrives }) => `${venue} ${leaves} ${to} ${arrives}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(destinations)(
    "reaches every token $key lists, so none is offered without a route",
    (chain) => {
      const arriving = bscBridgeRoutes
        .filter(({ to }) => to === chain.key)
        .map(({ arrives }) => arrives);
      expect(new Set(arriving)).toStrictEqual(new Set(symbolsOf(chain)));
    },
  );
});
