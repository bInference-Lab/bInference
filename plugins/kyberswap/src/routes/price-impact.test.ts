import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { priceImpactOf } from "./price-impact.js";

// Cents as KyberSwap writes dollars: whole dollars, a point and two digits.
function dollarsOf(cents: bigint): string {
  return `${String(cents / 100n)}.${String(cents % 100n).padStart(2, "0")}`;
}

// The exact loss in basis points times the input, which the impact must cover without overshoot.
function lossTimesInput(centsIn: bigint, centsOut: bigint): bigint {
  return centsOut >= centsIn ? 0n : (centsIn - centsOut) * 10_000n;
}

describe("the price impact of a kyberswap route", () => {
  it.each<[string, readonly [string, string], number]>([
    ["the recorded buy", ["76.75563175843", "76.72432550084646"], 5],
    ["the recorded sale", ["50.02421072883677", "50.0227893679375"], 1],
    ["no loss", ["10", "10.5"], 0],
    ["half lost", ["10", "5"], 5_000],
    ["a loss below a basis point, rounded up", ["10000", "9999.99"], 1],
  ])("is the share of the input lost: %s", (_case, [valueIn, valueOut], bps) => {
    expect(priceImpactOf(valueIn, valueOut)).toBe(bps);
  });

  it.each([
    ["an input priced at zero", "0", "5"],
    ["an output priced at zero", "5", "0"],
    ["no price", "", "5"],
    ["a price in another form", "5e2", "4"],
  ])("counts the whole input when it cannot be told: %s", (_case, valueIn, valueOut) => {
    expect(priceImpactOf(valueIn, valueOut)).toBe(10_000);
  });

  it("never understates the loss and stays within 0 to 10,000", () => {
    const cents = fc.bigInt({ min: 1n, max: 10n ** 15n });
    fc.assert(
      fc.property(cents, cents, (centsIn, centsOut) => {
        const bps = BigInt(priceImpactOf(dollarsOf(centsIn), dollarsOf(centsOut)));
        const lost = lossTimesInput(centsIn, centsOut);
        expect(bps * centsIn).toBeGreaterThanOrEqual(lost);
        expect(bps * centsIn - lost).toBeLessThan(centsIn);
        expect(bps).toBeLessThanOrEqual(10_000n);
      }),
    );
  });
});
