import type { Ratio } from "@binference/core";

/** The largest price scale: prices for 10^18 whole tokens. */
export const maxPriceScale = 18;

const microsPerDollar = 1_000_000n;

// Whether `price` USD for one token, times 10^scale, comes to at least one dollar.
const reachesADollar = (price: Ratio, scale: number): boolean =>
  price.numerator * 10n ** BigInt(scale) >= price.denominator;

/**
 * The price scale of a market read (decision 0184): the smallest of 0 to 18 at which the lowest
 * price above zero, in USD for one whole token, comes to at least one dollar for 10^scale tokens.
 * Prices of zero say nothing of the scale; none above zero is a scale of 0.
 */
export function priceScaleOf(prices: readonly Ratio[]): number {
  const positive = prices.filter((price) => price.numerator > 0n && price.denominator > 0n);
  let scale = 0;
  while (scale < maxPriceScale && !positive.every((price) => reachesADollar(price, scale))) {
    scale += 1;
  }
  return scale;
}

/** A price in USD for one whole token as micro-dollars for 10^scale tokens, rounded down. */
export function scaledUsdMicros(price: Ratio, scale: number): bigint {
  return (price.numerator * microsPerDollar * 10n ** BigInt(scale)) / price.denominator;
}
