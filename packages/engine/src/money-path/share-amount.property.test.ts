import { type Bps, bpsPerWhole } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { shareAmountBase } from "./share-amount.js";

const held = fc.bigInt({ min: 0n, max: 2n ** 256n - 1n });
const share = fc.integer({ min: 0, max: bpsPerWhole }).map((bps) => bps as Bps);
const whole = BigInt(bpsPerWhole);

describe("the amount a sale by share sells", () => {
  it("never sells more than the wallet holds", () => {
    fc.assert(
      fc.property(held, share, (heldBase, bps) => {
        expect(shareAmountBase(heldBase, bps)).toBeLessThanOrEqual(heldBase);
      }),
    );
  });

  it("sells less than the exact share by less than one base unit, never more than it", () => {
    fc.assert(
      fc.property(held, share, (heldBase, bps) => {
        const sold = shareAmountBase(heldBase, bps);
        // In units of 1/10000 of a base unit: the exact share is heldBase × bps.
        const shortfall = heldBase * BigInt(bps) - sold * whole;
        expect(shortfall).toBeGreaterThanOrEqual(0n);
        expect(shortfall).toBeLessThan(whole);
      }),
    );
  });

  it("sells all of the holding at 10000, and nothing at 0", () => {
    fc.assert(
      fc.property(held, (heldBase) => {
        expect(shareAmountBase(heldBase, bpsPerWhole as Bps)).toBe(heldBase);
        expect(shareAmountBase(heldBase, 0 as Bps)).toBe(0n);
      }),
    );
  });

  it("sells nothing of a holding that is empty or below zero", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(2n ** 64n), max: 0n }), share, (heldBase, bps) => {
        expect(shareAmountBase(heldBase, bps)).toBe(0n);
      }),
    );
  });
});
