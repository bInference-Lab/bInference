import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gasInAssetOut, rankRoutes, type RouteValue } from "./rank-routes.js";

const baseUnits = fc.bigInt({ min: 0n, max: 10n ** 30n });
const routeValue: fc.Arbitrary<RouteValue> = fc.record({
  receivedBase: baseUnits,
  gasBase: fc.bigInt({ min: 0n, max: 10n ** 20n }),
});

function netsIn(values: readonly RouteValue[], order: readonly number[]): readonly bigint[] {
  return order.map((index) => {
    const value = values[index];
    if (value === undefined) {
      throw new Error("The order names a route that does not exist.");
    }
    return value.receivedBase - value.gasBase;
  });
}

// Each next route is worth less, or as much and later in the venue order.
function isRanked(values: readonly RouteValue[], order: readonly number[]): boolean {
  const nets = netsIn(values, order);
  return order.every((index, place) => {
    const next = order[place + 1];
    const [here, after] = [nets[place] ?? 0n, nets[place + 1] ?? 0n];
    return next === undefined || here > after || (here === after && index < next);
  });
}

describe("route ranking", () => {
  it("places every route once, best net first, a tie in venue order", () => {
    fc.assert(
      fc.property(fc.array(routeValue, { maxLength: 6 }), (values: readonly RouteValue[]) => {
        const order = rankRoutes(values);
        expect(order.toSorted((a, b) => a - b)).toStrictEqual(values.map((_value, index) => index));
        expect(isRanked(values, order)).toBe(true);
      }),
    );
  });

  it("prices gas up, and not at all without a rate", () => {
    fc.assert(
      fc.property(
        baseUnits,
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        (gasUsed, numerator, denominator) => {
          const fee = 3n;
          const priced = gasInAssetOut(gasUsed, fee, { numerator, denominator });
          expect(priced * denominator).toBeGreaterThanOrEqual(gasUsed * fee * numerator);
          expect((priced - 1n) * denominator).toBeLessThan(gasUsed * fee * numerator);
          expect(gasInAssetOut(gasUsed, fee, undefined)).toBe(0n);
        },
      ),
    );
  });
});
