import type { AssetRef, ChainRef } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { marketDataContract } from "../contracts/market-data-contract.js";
import { priceSourceContract } from "../contracts/price-source-contract.js";
import { createSharedMarketData } from "./shared-market-data.js";

const chain = "fake:1" as ChainRef;
const coin = "fake:1/slip44:1" as AssetRef;
const token = "fake:1/token:a" as AssetRef;
const price = { numerator: 600n, denominator: 10n ** 12n };

describe("shared market data", () => {
  it.each(
    marketDataContract({
      create: () => {
        const market = createSharedMarketData();
        return {
          market,
          chain,
          asset: coin,
          otherAsset: token,
          publishBlock: (reading) => market.publishBlock(reading),
          publishPrice: (reading) => market.publishPrice(reading),
        };
      },
    }),
  )("follows the market data contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it.each(
    priceSourceContract({
      create: () => {
        const source = createSharedMarketData();
        source.publishPrice({ asset: coin, price, atMs: 1 });
        return { source, known: coin, unknown: token };
      },
    }),
  )("follows the price source contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("holds one subscription per asset however many watch it, until the last one stops", async () => {
    const market = createSharedMarketData();
    const first = new AbortController();
    const second = new AbortController();
    market.prices(coin, { signal: first.signal });
    const stream = market.prices(coin, { signal: second.signal })[Symbol.asyncIterator]();
    market.blocks(chain, { signal: first.signal });
    expect(market.subscriptions()).toBe(2);
    first.abort();
    expect(market.subscriptions()).toBe(1);
    await stream.return?.();
    second.abort();
    expect(market.subscriptions()).toBe(0);
  });

  it("drops the oldest readings of a watcher that falls 1,000 behind", async () => {
    const market = createSharedMarketData();
    const watching = new AbortController();
    const stream = market.blocks(chain, { signal: watching.signal })[Symbol.asyncIterator]();
    for (const number of Array.from({ length: 1_001 }, (_, index) => BigInt(index))) {
      market.publishBlock({ chain, number, atMs: 1 });
    }
    await expect(stream.next()).resolves.toMatchObject({ value: { number: 1n } });
    watching.abort();
  });

  it("prices an asset from its last reading", async () => {
    const market = createSharedMarketData();
    const live = { signal: new AbortController().signal };
    market.publishPrice({ asset: coin, price, atMs: 1 });
    market.publishPrice({
      asset: coin,
      price: { numerator: 610n, denominator: 10n ** 12n },
      atMs: 2,
    });
    await expect(market.usdPrice(coin, live)).resolves.toStrictEqual({
      ok: true,
      value: { numerator: 610n, denominator: 10n ** 12n },
    });
  });
});
