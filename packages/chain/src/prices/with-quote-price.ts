import { err, ok, type Result } from "@binference/core";
import type { Amount } from "../amount.js";
import type { AssetRef } from "../caip/asset-ref.js";
import type { PriceFailure, PriceSource, UsdPrice } from "../ports.js";

/** A trade's own amounts, as its quote gives them: what it spends and what it expects back. */
export interface QuotedTrade {
  readonly amountIn: Amount;
  readonly expectedOut: Amount;
}

interface QuoteSides {
  /** The side whose asset is asked for. */
  readonly own: Amount;
  /** The side the price comes from. */
  readonly other: Amount;
}

function sidesOf(quote: QuotedTrade, asset: AssetRef): QuoteSides | undefined {
  const { amountIn, expectedOut } = quote;
  if (amountIn.asset === expectedOut.asset) {
    return undefined;
  }
  if (asset === amountIn.asset) {
    return { own: amountIn, other: expectedOut };
  }
  return asset === expectedOut.asset ? { own: expectedOut, other: amountIn } : undefined;
}

// The other side is worth `other.base` units at its price, and the asset's own side is the same
// value spread over `own.base` units. The ratio stays exact, so only the caller rounds.
function spread(sides: QuoteSides, price: UsdPrice): Result<UsdPrice, PriceFailure> {
  const { own, other } = sides;
  return own.base > 0n && other.base > 0n && price.numerator > 0n && price.denominator > 0n
    ? ok({ numerator: other.base * price.numerator, denominator: price.denominator * own.base })
    : err("no_price");
}

/**
 * The price source of one trade (decision 0059): `prices` answers first, and the trade's other
 * token, which `prices` cannot price, takes its price from the trade's own quote, valued at the
 * side that `prices` does price. A trade between two tokens that `prices` cannot price leaves both
 * without a price, as does an empty side or a zero price. An asset `prices` answers
 * `price_refused` for never takes the quote's price (decision 0328), and a token priced from a
 * refused side is refused too. The engine's quote step owns the quote, so it wraps its source with
 * this once a quote exists.
 */
export function withQuotePrice(prices: PriceSource, quote: QuotedTrade): PriceSource {
  return {
    async usdPrice(asset, options) {
      const own = await prices.usdPrice(asset, options);
      const sides = sidesOf(quote, asset);
      if (own.ok || own.error === "price_refused" || sides === undefined) {
        return own;
      }
      const other = await prices.usdPrice(sides.other.asset, options);
      return other.ok ? spread(sides, other.value) : other;
    },
  };
}
