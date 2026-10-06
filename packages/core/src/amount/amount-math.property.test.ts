import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyBps, mulDiv, splitByBps } from "./amount-math.js";
import { bpsSchema } from "./basis-points.js";

const amount = fc.bigInt({ min: 0n, max: 2n ** 256n - 1n });
const bps = fc.integer({ min: 0, max: 10_000 }).map((value) => bpsSchema.parse(value));
const ratio = fc.record({
  numerator: fc.bigInt({ min: 0n, max: 2n ** 128n }),
  denominator: fc.bigInt({ min: 1n, max: 2n ** 128n }),
});

describe("amount math properties", () => {
  it("never loses a unit when it splits an amount", () => {
    fc.assert(
      fc.property(amount, bps, (value, rate) => {
        const { part, rest } = splitByBps(value, rate);
        expect(part + rest).toBe(value);
        expect(part).toBeGreaterThanOrEqual(0n);
        expect(rest).toBeGreaterThanOrEqual(0n);
      }),
    );
  });

  it("rounds down to at most the exact value and up to at least it, one unit apart", () => {
    fc.assert(
      fc.property(amount, ratio, (value, fraction) => {
        const exact = value * fraction.numerator;
        const down = mulDiv(value, fraction, "down");
        const up = mulDiv(value, fraction, "up");
        expect(down * fraction.denominator <= exact).toBe(true);
        expect(up * fraction.denominator >= exact).toBe(true);
        expect(up - down <= 1n).toBe(true);
      }),
    );
  });

  it("never takes more than the whole in basis points", () => {
    fc.assert(
      fc.property(amount, bps, (value, rate) => {
        expect(applyBps(value, rate, "up") <= value).toBe(true);
      }),
    );
  });

  it("grows with the rate", () => {
    fc.assert(
      fc.property(amount, bps, bps, (value, first, second) => {
        const [low = first, high = second] = [first, second].toSorted((a, b) => a - b);
        expect(applyBps(value, low, "down") <= applyBps(value, high, "down")).toBe(true);
      }),
    );
  });
});
