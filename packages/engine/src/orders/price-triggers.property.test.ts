import { type Bps, bpsPerWhole, type JsonValue, type Ratio } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { judgeTrigger, type TriggerJudgment, trailingStateDocument } from "./price-triggers.js";
import { testStopLoss } from "./test-orders.js";

const prices = fc.bigInt({ min: 1n, max: 10n ** 12n });
const ratios: fc.Arbitrary<Ratio> = fc.record({
  numerator: fc.bigInt({ min: 0n, max: 10n ** 30n }),
  denominator: fc.bigInt({ min: 1n, max: 10n ** 18n }),
});

function limitOf(trigger: { readonly price: bigint; readonly direction: "above" | "below" }) {
  return { ...testStopLoss(), kind: "limit" as const, trigger };
}

function fixedOf(kind: "takeProfit" | "stopLoss", price: bigint): OrderRequest {
  return { ...testStopLoss(), kind, trigger: { price } };
}

function trailingOf(distance: number): OrderRequest {
  return { ...testStopLoss(), kind: "trailing", trigger: { distanceBps: distance as Bps } };
}

const requests: fc.Arbitrary<OrderRequest> = fc.oneof(
  fc
    .record({ price: prices, direction: fc.constantFrom("above" as const, "below" as const) })
    .map(limitOf),
  fc
    .record({ kind: fc.constantFrom("takeProfit" as const, "stopLoss" as const), price: prices })
    .map(({ kind, price }) => fixedOf(kind, price)),
  fc.integer({ min: 1, max: bpsPerWhole - 1 }).map(trailingOf),
);

// `left` against `right` by cross-multiplying: below 0, 0 or above 0.
function sign(left: Ratio, right: Ratio): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  if (difference === 0n) {
    return 0;
  }
  return difference < 0n ? -1 : 1;
}

function highest(price: Ratio, peak: Ratio | undefined): Ratio {
  return peak === undefined || sign(price, peak) > 0 ? price : peak;
}

// Whether a price meets an order's condition, worked out apart from the module.
function oracleFires(request: OrderRequest, price: Ratio, peak: Ratio | undefined): boolean {
  const at = (level: bigint): number => sign(price, { numerator: level, denominator: 1n });
  if (request.kind === "limit") {
    const compared = at(request.trigger.price);
    return request.trigger.direction === "above" ? compared >= 0 : compared <= 0;
  }
  if (request.kind === "takeProfit" || request.kind === "stopLoss") {
    const compared = at(request.trigger.price);
    return request.kind === "takeProfit" ? compared >= 0 : compared <= 0;
  }
  if (request.kind !== "trailing") {
    return false;
  }
  const top = highest(price, peak);
  const kept = BigInt(bpsPerWhole - request.trigger.distanceBps);
  const scaled = price.numerator * top.denominator * BigInt(bpsPerWhole);
  return scaled <= top.numerator * price.denominator * kept;
}

function stateOf(peak: Ratio | undefined): { readonly triggerState?: JsonValue } {
  return peak === undefined ? {} : { triggerState: trailingStateDocument.encode({ peak }) };
}

function firesOf(judged: TriggerJudgment | undefined): boolean | undefined {
  return judged?.fires;
}

// What a trailing stop's judgment breaks of its peak: a peak raised on a price no higher, a higher
// price that raised none, or a peak other than the highest.
function peakViolation(request: OrderRequest, price: Ratio, peak: Ratio | undefined): string {
  const raised = judgeTrigger({ request, ...stateOf(peak) }, price)?.peak;
  const rises = peak === undefined || sign(price, peak) > 0;
  if (raised === undefined) {
    return rises ? "a higher price raised no peak" : "";
  }
  return rises && sign(raised, highest(price, peak)) === 0 ? "" : "a peak other than the highest";
}

const peaks = fc.option(
  ratios.filter(({ numerator }) => numerator > 0n),
  { nil: undefined },
);

describe("a price trigger, for every order, price and kept peak", () => {
  it("fires exactly when the price meets its order's condition, never outside it", () => {
    fc.assert(
      fc.property(requests, ratios, peaks, (request, price, peak) => {
        const judged = judgeTrigger({ request, ...stateOf(peak) }, price);
        expect(firesOf(judged)).toBe(oracleFires(request, price, peak));
      }),
      { numRuns: 5_000 },
    );
  });

  it("keeps a trailing stop's highest price, raising it only on a higher price", () => {
    const trailing = requests.filter((request) => request.kind === "trailing");
    fc.assert(
      fc.property(trailing, ratios, peaks, (request, price, peak) => {
        expect(peakViolation(request, price, peak)).toBe("");
      }),
      { numRuns: 2_000 },
    );
  });

  it("never fires a trailing stop on the price that set its peak", () => {
    const trailing = requests.filter((request) => request.kind === "trailing");
    fc.assert(
      fc.property(
        trailing,
        ratios.filter(({ numerator }) => numerator > 0n),
        (request, price) => {
          expect(firesOf(judgeTrigger({ request }, price))).toBe(false);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
