import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatTokenAmount, formatUsd } from "./format-amount.js";

// Reads a formatted number back as base units, with no float in between.
function baseUnitsOf(text: string, decimals: number): bigint {
  const [whole = "", fraction = ""] = text.replaceAll(",", "").split(".");
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

function significantDigits(text: string): number {
  return text.replace(/[^0-9]/g, "").replace(/^0+/, "").length;
}

const amounts = fc.bigInt({ min: 0n, max: 2n ** 256n - 1n });
const decimals = fc.integer({ min: 0, max: 36 });

describe("formatTokenAmount", () => {
  it("never shows more than the amount, and keeps 6 significant digits or the whole part", () => {
    fc.assert(
      fc.property(amounts, decimals, (amountBase, places) => {
        const text = formatTokenAmount(amountBase, places);
        const shown = baseUnitsOf(text, places);
        const whole = (amountBase / 10n ** BigInt(places)).toString();
        expect(shown <= amountBase).toBe(true);
        expect(significantDigits(text)).toBeLessThanOrEqual(Math.max(6, whole.length));
      }),
    );
  });

  it("shows an amount with at most 6 significant digits exactly", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 999_999n }), decimals, (amountBase, places) => {
        expect(baseUnitsOf(formatTokenAmount(amountBase, places), places)).toBe(amountBase);
      }),
    );
  });
});

describe("formatUsd", () => {
  it("rounds to the nearest cent, half away from zero, from a cent up", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 10_000n, max: 10n ** 30n }), (usdMicros) => {
        const cents = (usdMicros + 5_000n) / 10_000n;
        const text = formatUsd(usdMicros);
        expect(text).toMatch(/^\$[\d,]+\.\d{2}$/);
        expect(BigInt(text.replace(/[$,.]/g, ""))).toBe(cents);
        expect(formatUsd(-usdMicros)).toBe(`-${text}`);
      }),
    );
  });
});
