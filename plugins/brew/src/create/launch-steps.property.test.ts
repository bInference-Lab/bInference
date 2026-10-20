import * as fc from "fast-check";
import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { btcb } from "../testing/launch-fixtures.js";
import { bnb } from "../testing/recorded-launches.js";
import { defaultStartOf } from "./launch-steps.js";

// $5,000 in micro-dollars, the start of a pair with no fixed one.
const fiveThousand = 5_000_000_000n;

// A USD price: micro-dollars for a number of the pair's base units, both above 0.
const priceOf = fc.record({
  numerator: fc.bigInt({ min: 1n, max: 10n ** 30n }),
  denominator: fc.bigInt({ min: 1n, max: 10n ** 30n }),
});
const unfixed = { asset: btcb, decimals: 18 };

// The start of a pair with no fixed one at a price at which a base unit is worth at most $5,000.
function startAt(price: { readonly numerator: bigint; readonly denominator: bigint }): bigint {
  const start = defaultStartOf(unfixed, price);
  if (start === undefined) {
    throw new Error("A pair a base unit of which is worth at most $5,000 has a start.");
  }
  return start;
}

describe("a Brew pair's default start", () => {
  it("is the most of the pair worth at most $5,000 at its price, short by under one base unit", () => {
    fc.assert(
      fc.property(priceOf, (price) => {
        fc.pre(price.numerator <= fiveThousand * price.denominator);
        const start = startAt(price);
        const most = fiveThousand * price.denominator;
        expect(start * price.numerator).toBeLessThanOrEqual(most);
        expect((start + 1n) * price.numerator).toBeGreaterThan(most);
        expect(start).toBeGreaterThan(0n);
      }),
    );
  });

  it("is none when one base unit of the pair is worth more than $5,000", () => {
    fc.assert(
      fc.property(priceOf, (price) => {
        fc.pre(price.numerator > fiveThousand * price.denominator);
        expect(defaultStartOf(unfixed, price)).toBeUndefined();
      }),
    );
  });

  it("keeps a pair's fixed start at any price, or with none", () => {
    fc.assert(
      fc.property(fc.option(priceOf, { nil: undefined }), (price) => {
        const pair = { asset: bnb, decimals: 18, startBase: parseEther("8") };
        expect(defaultStartOf(pair, price)).toBe(parseEther("8"));
      }),
    );
  });
});
