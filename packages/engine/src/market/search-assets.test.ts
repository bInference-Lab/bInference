import { assetRefSchema, createChainRegistry, type RegisteredChain } from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigningScheme,
} from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { searchAssets } from "./search-assets.js";

const base = createFakeChainDefinition();
const [listed] = base.tokens;
const verification = listed?.verification ?? {
  source: "https://example.invalid",
  checkedOn: "2026-10-11",
  control: "read" as const,
};
const chains = createChainRegistry({
  chains: [
    {
      ...base,
      tokens: [
        { symbol: "USDT", name: "Tether USD", decimals: 18, address: "0x000000b1", verification },
        { symbol: "USDC", name: "USD Coin", decimals: 18, address: "0x000000b2", verification },
        {
          symbol: "WFAKE",
          name: "Wrapped Fake",
          decimals: 18,
          address: "0x000000b3",
          verification,
        },
      ],
    },
  ],
  families: [createFakeFamily()],
  signingSchemes: [createFakeSigningScheme()],
});
const [chain] = chains.list() as readonly [RegisteredChain];
const coin = assetRefSchema.parse("fake:1/slip44:1");
const usdt = assetRefSchema.parse("fake:1/token:0x000000b1");
const usdc = assetRefSchema.parse("fake:1/token:0x000000b2");
const unlisted = assetRefSchema.parse("fake:1/token:0x000000c1");

function search(query: string, held: readonly (typeof unlisted)[] = []) {
  return searchAssets(chains, { chain, query, held: new Set(held) });
}

describe("the asset search", () => {
  it("finds a registry token by its symbol in any case, with the registry's info", () => {
    expect(search(" usdt ")).toStrictEqual({
      items: [{ asset: usdt, symbol: "USDT", name: "Tether USD", decimals: 18, verified: true }],
    });
  });

  it("finds the chain's coin by its symbol, ahead of names that hold the symbol", () => {
    expect(search("FAKE").items.map((view) => view.asset)).toStrictEqual([coin]);
  });

  it("says a text is ambiguous when several names hold it and no symbol matches", () => {
    const found = search("usd");
    expect(found.items.map((view) => view.asset)).toStrictEqual([usdt, usdc]);
    expect(found.ambiguous).toBe(true);
  });

  it("finds a registry token by its address in the family's canonical form", () => {
    expect(search("0x000000B1").items.map((view) => view.asset)).toStrictEqual([usdt]);
  });

  it("answers an address the registry does not list as unlisted, held or not", () => {
    expect(search("0x000000C1", [unlisted])).toStrictEqual({
      items: [],
      unlisted: [{ asset: unlisted, held: true }],
    });
    expect(search("0x000000c1").unlisted).toStrictEqual([{ asset: unlisted, held: false }]);
  });

  it("finds nothing for text no symbol or name holds", () => {
    expect(search("doge")).toStrictEqual({ items: [] });
  });
});
