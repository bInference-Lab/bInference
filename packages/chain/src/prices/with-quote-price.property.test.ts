import assert from "node:assert/strict";
import { err, mulDiv, ok } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assetRefSchema } from "../caip/asset-ref.js";
import type { PriceSource, UsdPrice } from "../ports.js";
import { type QuotedTrade, withQuotePrice } from "./with-quote-price.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:a");
const live = { signal: new AbortController().signal };

function coinFeed(price: UsdPrice): PriceSource {
  return {
    usdPrice: async (asset) => Promise.resolve(asset === coin ? ok(price) : err("no_price")),
  };
}

/** A quote between the token and the coin, either way round, and the coin's feed price. */
interface QuoteCase {
  readonly tokenBase: bigint;
  readonly coinBase: bigint;
  readonly coinPrice: UsdPrice;
  readonly quote: QuotedTrade;
}

const base = fc.bigInt({ min: 1n, max: 10n ** 30n });
const cases: fc.Arbitrary<QuoteCase> = fc
  .tuple(base, base, fc.record({ numerator: base, denominator: base }), fc.boolean())
  .map((parts: readonly [bigint, bigint, UsdPrice, boolean]): QuoteCase => {
    const [tokenBase, coinBase, coinPrice, isSale] = parts;
    const tokenSide = { asset: token, base: tokenBase };
    const coinSide = { asset: coin, base: coinBase };
    const quote = isSale
      ? { amountIn: tokenSide, expectedOut: coinSide }
      : { amountIn: coinSide, expectedOut: tokenSide };
    return { tokenBase, coinBase, coinPrice, quote };
  });

describe("a price from the trade's own quote", () => {
  it("values the token's side of a quote at exactly the other side's value, either way round", async () => {
    await fc.assert(
      fc.asyncProperty(cases, async (item: QuoteCase) => {
        const { tokenBase, coinBase, coinPrice, quote } = item;
        const priced = await withQuotePrice(coinFeed(coinPrice), quote).usdPrice(token, live);
        assert.ok(priced.ok);
        expect(mulDiv(tokenBase, priced.value, "up")).toBe(mulDiv(coinBase, coinPrice, "up"));
        expect(mulDiv(tokenBase, priced.value, "down")).toBe(mulDiv(coinBase, coinPrice, "down"));
      }),
    );
  });
});
