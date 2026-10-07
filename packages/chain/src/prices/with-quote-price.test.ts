import { err, mulDiv, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { assetRefSchema } from "../caip/asset-ref.js";
import { priceSourceContract } from "../contracts/price-source-contract.js";
import type { PriceSource, UsdPrice } from "../ports.js";
import { type QuotedTrade, withQuotePrice } from "./with-quote-price.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const stable = assetRefSchema.parse("fake:1/token:usd");
const token = assetRefSchema.parse("fake:1/token:a");
const other = assetRefSchema.parse("fake:1/token:b");
const live = { signal: new AbortController().signal };

// $600 a coin and $1 a stable unit, both with 18 decimals.
const coinPrice: UsdPrice = { numerator: 600_000_000n, denominator: 10n ** 18n };
const stablePrice: UsdPrice = { numerator: 1_000_000n, denominator: 10n ** 18n };

function feeds(prices: ReadonlyMap<string, UsdPrice>): PriceSource {
  return {
    async usdPrice(asset, options) {
      options.signal.throwIfAborted();
      const price = prices.get(asset);
      return await Promise.resolve(price === undefined ? err("no_price") : ok(price));
    },
  };
}

const coinFeed = feeds(new Map([[coin, coinPrice]]));

// Sells 2,000 whole tokens (6 decimals) for 0.5 coin.
const sale = {
  amountIn: { asset: token, base: 2_000_000_000n },
  expectedOut: { asset: coin, base: 5n * 10n ** 17n },
};

describe("a price from the trade's own quote", () => {
  it.each(
    priceSourceContract({
      create: () => ({ source: withQuotePrice(coinFeed, sale), known: token, unknown: other }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("values the sold token at what the quote pays for it", async () => {
    const price = await withQuotePrice(coinFeed, sale).usdPrice(token, live);
    expect(price).toStrictEqual(
      ok({ numerator: 5n * 10n ** 17n * 600_000_000n, denominator: 10n ** 18n * 2_000_000_000n }),
    );
  });

  it("values the bought token at what the trade spends on it", async () => {
    const buy = {
      amountIn: { asset: stable, base: 300n * 10n ** 18n },
      expectedOut: { asset: token, base: 1_500_000_000n },
    };
    const source = withQuotePrice(feeds(new Map([[stable, stablePrice]])), buy);
    const expected = {
      numerator: 300n * 10n ** 18n * 1_000_000n,
      denominator: 10n ** 18n * 1_500_000_000n,
    };
    await expect(source.usdPrice(token, live)).resolves.toStrictEqual(ok(expected));
    // 1,500 whole tokens for $300 is $0.20 a token.
    expect(mulDiv(1_000_000n, expected, "down")).toBe(200_000n);
  });

  it("keeps the feed's price for an asset the feeds price", async () => {
    await expect(withQuotePrice(coinFeed, sale).usdPrice(coin, live)).resolves.toStrictEqual(
      ok(coinPrice),
    );
  });

  it.each<[string, PriceSource, QuotedTrade]>([
    ["neither side has a feed price", feeds(new Map()), sale],
    ["the quote pays nothing", coinFeed, { ...sale, expectedOut: { asset: coin, base: 0n } }],
    ["the quote spends nothing", coinFeed, { ...sale, amountIn: { asset: token, base: 0n } }],
    [
      "the other side's price is zero",
      feeds(new Map([[coin, { ...coinPrice, numerator: 0n }]])),
      sale,
    ],
    [
      "both sides are the same asset",
      coinFeed,
      { ...sale, expectedOut: { asset: token, base: 1n } },
    ],
  ])("has no price when %s", async (_case, prices, quote) => {
    await expect(withQuotePrice(prices, quote).usdPrice(token, live)).resolves.toStrictEqual(
      err("no_price"),
    );
  });
});
