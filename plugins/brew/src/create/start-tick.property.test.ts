import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { startTickOf } from "./start-tick.js";

// Brew's supply, 1,000,000,000 tokens of 18 decimals, and its 1% tier's spacing.
const supplyBase = 10n ** 27n;
const spacing = 200;

// A market cap of a whole amount of a pair with 6 or 18 decimals, as USDC elsewhere and BNB or
// BSC's USDT have, from one unit to ten billion.
const startOf = fc
  .record({
    decimals: fc.constantFrom(6, 18),
    whole: fc.bigInt({ min: 1n, max: 10n ** 10n }),
  })
  .map(({ decimals, whole }) => whole * 10n ** BigInt(decimals));

// The starting tick of a market cap every tick in the pool's bounds reaches.
function tickOf(marketCapBase: bigint): number {
  const tick = startTickOf({ marketCapBase, supplyBase, spacing });
  if (tick === undefined) {
    throw new Error(`No tick reaches a market cap of ${marketCapBase}.`);
  }
  return tick;
}

// The tick at which the pool's price, 1.0001^tick, is the market cap over the supply, in floating
// point; a float's last bits may round across a step's edge, where the integer search decides.
const exactTickOf = (marketCapBase: bigint): number =>
  (Math.log(Number(marketCapBase)) - Math.log(Number(supplyBase))) / Math.log(1.0001);
const roundingRoom = 1e-6;

describe("a Brew launch's starting tick", () => {
  it("sits on the spacing, at or one step below the market cap's own tick", () => {
    fc.assert(
      fc.property(startOf, (marketCapBase) => {
        const tick = tickOf(marketCapBase);
        const exact = exactTickOf(marketCapBase);
        expect(Math.abs(tick % spacing)).toBe(0);
        expect(tick).toBeLessThanOrEqual(exact + roundingRoom);
        expect(tick + spacing).toBeGreaterThan(exact - roundingRoom);
      }),
    );
  });

  it("is negative below a market cap of one pair unit per token unit, and not below it", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 40n }), (marketCapBase) => {
        expect(tickOf(marketCapBase) < 0).toBe(marketCapBase < supplyBase);
      }),
    );
  });

  it("never falls as the market cap grows", () => {
    fc.assert(
      fc.property(startOf, fc.bigInt({ min: 0n, max: 10n ** 30n }), (low, more) => {
        expect(tickOf(low)).toBeLessThanOrEqual(tickOf(low + more));
      }),
    );
  });
});
