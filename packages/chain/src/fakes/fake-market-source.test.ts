import { describe, expect, it } from "vitest";
import { assetRefSchema } from "../caip/asset-ref.js";
import { chainRefSchema } from "../caip/chain-ref.js";
import { marketCandlesContract } from "../contracts/market-candles-contract.js";
import { marketDataSourceContract } from "../contracts/market-data-source-contract.js";
import { marketPricesContract } from "../contracts/market-prices-contract.js";
import { createFakeMarketSource, type FakeMarketSourceOptions } from "./fake-market-source.js";

const chain = chainRefSchema.parse("fake:1");
const known = assetRefSchema.parse("fake:1/token:0x0000000a");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const unknown = assetRefSchema.parse("fake:1/token:0x0000000f");
const uncovered = assetRefSchema.parse("fake:2/token:0x0000000a");
const pool = {
  dex: "fake-swap",
  pool: "0x0000000d",
  base: known,
  quote: coin,
  priceUsd: { numerator: 3n, denominator: 2n },
  liquidityUsdMicros: 5_000_000n,
};
const hourMs = 3_600_000;
const candleAt = (hour: number) => ({
  atMs: hour * hourMs,
  open: { numerator: 3n, denominator: 2n },
  high: { numerator: 2n, denominator: 1n },
  low: { numerator: 1n, denominator: 1n },
  close: { numerator: 3n, denominator: 2n },
  volumeUsdMicros: 7_000_000n,
});
const options: FakeMarketSourceOptions = {
  id: "fake",
  chains: [chain],
  pools: new Map([[known, [pool]]]),
  trending: new Map([[chain, [{ asset: known, pool, activeBoosts: 3 }]]]),
  candles: new Map([[known, [1, 2, 3, 4, 5].map(candleAt)]]),
  prices: new Map([[known, { numerator: 3n, denominator: 2n }]]),
};
const live = { signal: new AbortController().signal };
const harness = {
  create: () => ({
    source: createFakeMarketSource(options),
    known,
    unknown,
    uncovered,
    down: createFakeMarketSource({ ...options, isDown: true }),
  }),
};

describe("fake market source", () => {
  it.each([
    ...marketDataSourceContract(harness),
    ...marketCandlesContract(harness),
    ...marketPricesContract(harness),
  ])("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads the newest candles before a time, oldest first, up to the limit", async () => {
    const source = createFakeMarketSource(options);
    const request = { interval: "1h" as const, beforeMs: 5 * hourMs, limit: 2 };
    await expect(source.candles?.(known, request, live)).resolves.toStrictEqual({
      ok: true,
      value: [candleAt(3), candleAt(4)],
    });
  });

  it("reads neither candles nor prices without tables of them", () => {
    const { candles: _candles, prices: _prices, ...plain } = options;
    const source = createFakeMarketSource(plain);
    expect([source.candles, source.prices]).toStrictEqual([undefined, undefined]);
  });

  it("counts every read that reaches it, the refused ones too", async () => {
    const source = createFakeMarketSource({ ...options, isDown: true });
    await expect(source.pools(known, live)).rejects.toMatchObject({ code: "fake.unavailable" });
    await expect(source.trending(chain, live)).rejects.toMatchObject({ retryable: true });
    expect(source.reads()).toBe(2);
  });
});
