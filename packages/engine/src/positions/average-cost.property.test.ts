import { mulDiv, type Ratio } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { acquire, type CostBasis, dispose, emptyCostBasis } from "./average-cost.js";

interface Step {
  readonly buys: boolean;
  readonly quantityBase: bigint;
  readonly usdMicros: bigint;
}

const steps: fc.Arbitrary<readonly Step[]> = fc.array(
  fc.record({
    buys: fc.boolean(),
    // Small quantities put sales on the position's whole holding often.
    quantityBase: fc.oneof(
      fc.bigInt({ min: 0n, max: 5n }),
      fc.bigInt({ min: 0n, max: 10n ** 24n }),
    ),
    usdMicros: fc.bigInt({ min: 0n, max: 10n ** 12n }),
  }),
  { maxLength: 40 },
);

const prices: fc.Arbitrary<Ratio> = fc.record({
  numerator: fc.bigInt({ min: 0n, max: 10n ** 9n }),
  denominator: fc.bigInt({ min: 1n, max: 10n ** 18n }),
});

function applyStep(basis: CostBasis, step: Step): CostBasis {
  return step.buys
    ? acquire(basis, step.quantityBase, step.usdMicros)
    : dispose(basis, step.quantityBase, step.usdMicros);
}

// Every basis a run of steps passes through, sales beyond the holding included.
function history(all: readonly Step[]): readonly CostBasis[] {
  const bases: CostBasis[] = [];
  for (const step of all) {
    bases.push(applyStep(bases.at(-1) ?? emptyCostBasis, step));
  }
  return bases;
}

interface Totals {
  readonly basis: CostBasis;
  readonly paidUsdMicros: bigint;
  readonly proceedsUsdMicros: bigint;
}

// Runs the steps with every sale cut to what the position holds, and adds up the money that moved.
function covered(all: readonly Step[]): Totals {
  let totals: Totals = { basis: emptyCostBasis, paidUsdMicros: 0n, proceedsUsdMicros: 0n };
  for (const step of all) {
    const quantityBase = step.buys
      ? step.quantityBase
      : step.quantityBase % (totals.basis.quantityBase + 1n);
    const usdMicros = quantityBase === 0n && !step.buys ? 0n : step.usdMicros;
    totals = {
      basis: applyStep(totals.basis, { buys: step.buys, quantityBase, usdMicros }),
      paidUsdMicros: totals.paidUsdMicros + (step.buys ? usdMicros : 0n),
      proceedsUsdMicros: totals.proceedsUsdMicros + (step.buys ? 0n : usdMicros),
    };
  }
  return totals;
}

const isNegative = (basis: CostBasis): boolean =>
  basis.quantityBase < 0n || basis.costUsdMicros < 0n;
const costsWithoutHolding = (basis: CostBasis): boolean =>
  basis.quantityBase === 0n && basis.costUsdMicros !== 0n;

describe("average cost properties", () => {
  it("never holds a negative quantity or cost, and nothing held costs nothing", () => {
    fc.assert(
      fc.property(steps, (all) => {
        const bases = history(all);
        expect(bases.filter(isNegative)).toStrictEqual([]);
        expect(bases.filter(costsWithoutHolding)).toStrictEqual([]);
      }),
    );
  });

  it("makes realized plus unrealized equal proceeds plus value less every cost paid", () => {
    fc.assert(
      fc.property(steps, prices, (all, price) => {
        const { basis, paidUsdMicros, proceedsUsdMicros } = covered(all);
        const valueUsdMicros = mulDiv(basis.quantityBase, price, "down");
        const unrealizedUsdMicros = valueUsdMicros - basis.costUsdMicros;
        expect(basis.realizedUsdMicros + unrealizedUsdMicros).toBe(
          proceedsUsdMicros + valueUsdMicros - paidUsdMicros,
        );
      }),
    );
  });
});
