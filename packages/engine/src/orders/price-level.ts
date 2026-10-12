import type { Ratio } from "@binference/core";

/**
 * A level a token's price is judged against, in micro-dollars per whole token, exact: met when
 * the price is at or above it, or at or below it.
 */
export interface PriceLevel {
  readonly side: "atOrAbove" | "atOrBelow";
  readonly price: Ratio;
}

/**
 * Compares two non-negative fractions with positive denominators exactly: below 0 when `left` is
 * smaller, 0 when they are equal, above 0 when it is larger.
 */
export function compareRatios(left: Ratio, right: Ratio): number {
  const crossLeft = left.numerator * right.denominator;
  const crossRight = right.numerator * left.denominator;
  if (crossLeft === crossRight) {
    return 0;
  }
  return crossLeft < crossRight ? -1 : 1;
}

/** Whether a price meets a level: at or above it, or at or below it, as the level says. */
export function meetsLevel(price: Ratio, level: PriceLevel): boolean {
  const order = compareRatios(price, level.price);
  return level.side === "atOrAbove" ? order >= 0 : order <= 0;
}

/** A price per base unit as a price per whole token: times 10 to the token's decimals. */
export function wholeTokenPrice(perBaseUnit: Ratio, decimals: number): Ratio {
  return {
    numerator: perBaseUnit.numerator * 10n ** BigInt(decimals),
    denominator: perBaseUnit.denominator,
  };
}
