import { type Bps, bpsPerWhole, type JsonValue } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testToken } from "../intents/test-intents.js";
import type { WatchedOrderPrice } from "./order-triggers.js";
import { triggerStateDocument } from "./price-triggers.js";
import { activeOrder, startFillEngine, wholeToken } from "./test-fills.js";
import { storedOrder, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

function at(micros: bigint): WatchedOrderPrice {
  return {
    token: testToken,
    usdPerBaseUnit: { numerator: micros, denominator: wholeToken },
    decimals: 6,
    isThin: false,
    readAtMs: 0,
  };
}

// What a trailing stop fires on, read in order: the index of the first price at or under its
// distance below the highest price before it, this one included, and the highest price until then.
function oracleOf(
  distanceBps: number,
  prices: readonly bigint[],
): { readonly fireAt: number; readonly peak: bigint } {
  const step = (
    seen: { readonly fireAt: number; readonly peak: bigint },
    micros: bigint,
    index: number,
  ) => {
    if (seen.fireAt >= 0) {
      return seen;
    }
    const peak = micros > seen.peak ? micros : seen.peak;
    const fires = micros * BigInt(bpsPerWhole) <= peak * BigInt(bpsPerWhole - distanceBps);
    return { fireAt: fires ? index : -1, peak };
  };
  return prices.reduce(step, { fireAt: -1, peak: 0n });
}

// The peak an order keeps, in micro-dollars a whole token, rounded down; 0 for none.
function peakOf(state: JsonValue | undefined): bigint {
  const peak = state === undefined ? undefined : triggerStateDocument.decode(state).peak;
  return peak === undefined ? 0n : peak.numerator / peak.denominator;
}

// The peak the order kept while it had not fired; the oracle's own once it fired and filled.
function keptPeak(
  oracle: { readonly fireAt: number; readonly peak: bigint },
  state: JsonValue | undefined,
): bigint {
  return oracle.fireAt >= 0 ? oracle.peak : peakOf(state);
}

const bursts: fc.Arbitrary<readonly bigint[]> = fc.array(
  fc.bigInt({ min: 500_000n, max: 2_000_000n }),
  { minLength: 1, maxLength: 8 },
);

describe("a burst of prices of one token, handed on without waiting, for every run of prices", () => {
  it("judges them in order as if one by one: the peak kept, and the fire at its price", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 100, max: 3_000 }), bursts, async (distance, prices) => {
        const test = await startFillEngine();
        const order = await activeOrder(test, {
          ...testStopLoss(),
          kind: "trailing",
          trigger: { distanceBps: distance as Bps },
        });
        const outcomes = await Promise.all(
          prices.map(async (micros) => test.engine.seePrice(at(micros), live)),
        );
        const oracle = oracleOf(distance, prices);
        const fireAt = outcomes.findIndex((each) =>
          each.some(({ outcome }) => outcome === "filled"),
        );
        const stored = await storedOrder(test, order.id);
        expect(fireAt).toBe(oracle.fireAt);
        expect(keptPeak(oracle, stored.triggerState)).toBe(oracle.peak);
      }),
      { numRuns: 60 },
    );
  });
});
