import type { Ratio } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { priceScaleOf, scaledUsdMicros } from "./price-scale.js";

// Prices from 1e-18 dollars up, so a scale of 18 or less always brings each to a dollar.
const prices = fc.array(
  fc.record({
    numerator: fc.bigInt({ min: 1n, max: 10n ** 24n }),
    denominator: fc.bigInt({ min: 1n, max: 10n ** 18n }),
  }),
  { minLength: 1, maxLength: 8 },
);

// Whether every price comes to at least a dollar for 10^scale tokens.
const allReachADollar = (each: readonly Ratio[], scale: number): boolean =>
  each.every((price) => scaledUsdMicros(price, scale) >= 1_000_000n);

describe("the price scale, for any prices of 1e-18 dollars or more", () => {
  it("brings every price to a dollar or more", () => {
    fc.assert(
      fc.property(prices, (each: readonly Ratio[]) => {
        expect(allReachADollar(each, priceScaleOf(each))).toBe(true);
      }),
    );
  });

  it("is the smallest such scale: one less leaves a price below a dollar", () => {
    fc.assert(
      fc.property(prices, (each: readonly Ratio[]) => {
        const scale = priceScaleOf(each);
        expect(allReachADollar(each, Math.max(scale - 1, 0))).toBe(scale === 0);
      }),
    );
  });
});
