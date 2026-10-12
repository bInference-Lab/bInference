import { assetRefSchema, chainRefSchema, type MarketDataSource } from "@binference/chain";
import { createFakeMarketSource } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { defineData } from "./define-data.js";
import { marketDataSourceContract } from "./testing.js";

const chain = chainRefSchema.parse("fake:1");
const known = assetRefSchema.parse("fake:1/token:0x0000000a");
const pool = {
  dex: "fake-swap",
  pool: "0x0000000d",
  base: known,
  quote: assetRefSchema.parse("fake:1/slip44:1"),
  liquidityUsdMicros: 5_000_000n,
};
const options = {
  id: "fake-data",
  chains: [chain],
  pools: new Map([[known, [pool]]]),
  trending: new Map([[chain, [{ asset: known, pool }]]]),
};

describe("defineData", () => {
  it.each(
    marketDataSourceContract({
      create: () => ({
        source: defineData(createFakeMarketSource(options)),
        known,
        unknown: assetRefSchema.parse("fake:1/token:0x0000000f"),
        uncovered: assetRefSchema.parse("fake:2/token:0x0000000a"),
        down: defineData(createFakeMarketSource({ ...options, isDown: true })),
      }),
    }),
  )("gives a source that follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("returns a frozen source that keeps its id and reads through the definition", async () => {
    const definition = createFakeMarketSource(options);
    const source = defineData(definition);
    expect(Object.isFrozen(source)).toBe(true);
    expect(source.id).toBe("fake-data");
    await source.trending(chain, { signal: new AbortController().signal });
    expect(definition.reads()).toBe(1);
  });

  it.each([
    ["an id in capitals", { id: "DexData" }],
    ["an empty id", { id: "" }],
    ["an id past 32 characters", { id: `a${"b".repeat(32)}` }],
    ["no trending read", { trending: undefined }],
  ])("refuses a declaration with %s as a bad data plugin", (_case, change) => {
    const definition = { ...createFakeMarketSource(options), ...change } as MarketDataSource;
    expect(() => defineData(definition)).toThrow(
      expect.objectContaining({ code: "plugin.bad_data" }),
    );
  });
});
