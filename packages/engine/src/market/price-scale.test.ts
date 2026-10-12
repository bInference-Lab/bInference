import type { Ratio } from "@binference/core";
import { describe, expect, it } from "vitest";
import { priceScaleOf, scaledUsdMicros } from "./price-scale.js";

const usd = (numerator: bigint, denominator = 1n) => ({ numerator, denominator });

describe("the price scale", () => {
  it.each([
    ["a dollar or more", [usd(75_099n, 100n), usd(1n)], 0],
    ["no price above zero", [usd(0n)], 0],
    ["no price at all", [], 0],
    ["a price of 7.525e-5 dollars", [usd(7_525n, 100_000_000n), usd(1n)], 5],
    ["a price of 1e-7 dollars, beside zero", [usd(1n, 10_000_000n), usd(0n)], 7],
    ["a price of 1e-30 dollars", [usd(1n, 10n ** 30n)], 18],
  ])(
    "is the smallest that brings the lowest price to a dollar, for %s",
    (_case, prices: readonly Ratio[], scale) => {
      expect(priceScaleOf(prices)).toBe(scale);
    },
  );

  it("turns a price into micro-dollars for 10^scale tokens, rounded down", () => {
    expect([
      scaledUsdMicros(usd(75_099n, 100n), 0),
      scaledUsdMicros(usd(7_525n, 100_000_000n), 5),
      scaledUsdMicros(usd(1n, 3n), 0),
      scaledUsdMicros(usd(0n), 4),
    ]).toStrictEqual([750_990_000n, 7_525_000n, 333_333n, 0n]);
  });
});
