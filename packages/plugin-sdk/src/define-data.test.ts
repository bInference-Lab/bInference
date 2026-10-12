import { assetRefSchema, chainRefSchema, type MarketDataSource } from "@binference/chain";
import { createFakeMarketSource } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { defineData } from "./define-data.js";
import {
  marketCandlesContract,
  marketDataSourceContract,
  marketPricesContract,
} from "./testing.js";

const chain = chainRefSchema.parse("fake:1");
const known = assetRefSchema.parse("fake:1/token:0x0000000a");
const pool = {
  dex: "fake-swap",
  pool: "0x0000000d",
  base: known,
  quote: assetRefSchema.parse("fake:1/slip44:1"),
  liquidityUsdMicros: 5_000_000n,
};
const price = { numerator: 3n, denominator: 2n };
const candle = { atMs: 0, open: price, high: price, low: price, close: price, volumeUsdMicros: 0n };
const options = {
  id: "fake-data",
  chains: [chain],
  pools: new Map([[known, [pool]]]),
  trending: new Map([[chain, [{ asset: known, pool }]]]),
  candles: new Map([[known, [candle]]]),
  prices: new Map([[known, price]]),
};

describe("defineData", () => {
  const harness = {
    create: () => ({
      source: defineData(createFakeMarketSource(options)),
      known,
      unknown: assetRefSchema.parse("fake:1/token:0x0000000f"),
      uncovered: assetRefSchema.parse("fake:2/token:0x0000000a"),
      down: defineData(createFakeMarketSource({ ...options, isDown: true })),
    }),
  };

  it.each([
    ...marketDataSourceContract(harness),
    ...marketCandlesContract(harness),
    ...marketPricesContract(harness),
  ])("gives a source that follows the contract: $name", async ({ run }) => {
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

  it("gives a source without candles or prices none", () => {
    const { candles: _candles, prices: _prices, ...plain } = options;
    const source = defineData(createFakeMarketSource(plain));
    expect([source.candles, source.prices]).toStrictEqual([undefined, undefined]);
  });

  it.each([
    ["a candle read that is no function", { candles: "1h" }],
    ["a price read that is no function", { prices: 1 }],
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
