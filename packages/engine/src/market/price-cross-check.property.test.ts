import type { Ratio } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gapBpsOf } from "./price-cross-check.js";

const token = "fake:1/token:0x0000000a" as never;
const decimals = fc.integer({ min: 0, max: 30 });
const dollars = fc.record({
  numerator: fc.bigInt({ min: 1n, max: 10n ** 24n }),
  denominator: fc.bigInt({ min: 1n, max: 10n ** 18n }),
});

// The watcher's micro-dollars per base unit for a price in dollars per whole token.
const perBaseUnit = (price: Ratio, scale: number): Ratio => ({
  numerator: price.numerator * 1_000_000n,
  denominator: price.denominator * 10n ** BigInt(scale),
});

describe("the cross-check's gap, for any price and any decimals", () => {
  it("is zero when the watcher's price is the source's", () => {
    fc.assert(
      fc.property(dollars, decimals, (price: Ratio, scale: number) => {
        const sample = { token, usdPrice: perBaseUnit(price, scale), decimals: scale };
        expect(gapBpsOf(sample, price)).toBe(0n);
      }),
    );
  });

  it("is the share the watcher's price is off, rounded down, at most 100 times", () => {
    fc.assert(
      fc.property(
        dollars,
        decimals,
        fc.integer({ min: 0, max: 20_000 }),
        (price: Ratio, scale: number, offBps: number) => {
          const watched = {
            numerator: price.numerator * BigInt(10_000 + offBps),
            denominator: price.denominator * 10_000n,
          };
          const sample = { token, usdPrice: perBaseUnit(watched, scale), decimals: scale };
          expect(gapBpsOf(sample, price)).toBe(BigInt(offBps));
        },
      ),
    );
  });
});
