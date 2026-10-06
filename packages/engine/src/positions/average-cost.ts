import { BinferenceError, mulDiv } from "@binference/core";

/** A position's running totals at average cost, in base units and micro-dollars. */
export interface CostBasis {
  readonly quantityBase: bigint;
  readonly costUsdMicros: bigint;
  /** Below zero for a loss. */
  readonly realizedUsdMicros: bigint;
}

/** A position that holds nothing and has realized nothing. */
export const emptyCostBasis: CostBasis = {
  quantityBase: 0n,
  costUsdMicros: 0n,
  realizedUsdMicros: 0n,
};

function assertNotNegative(values: readonly bigint[]): void {
  if (values.some((value) => value < 0n)) {
    throw new BinferenceError({
      code: "positions.negative_amount",
      message: "A quantity, cost or proceeds must not be negative.",
    });
  }
}

/**
 * Adds units bought and their full cost (decision 0058). Buying no units holds nothing, so the
 * cost is a realized loss at once.
 */
export function acquire(basis: CostBasis, quantityBase: bigint, costUsdMicros: bigint): CostBasis {
  assertNotNegative([quantityBase, costUsdMicros]);
  if (quantityBase === 0n) {
    return { ...basis, realizedUsdMicros: basis.realizedUsdMicros - costUsdMicros };
  }
  return {
    ...basis,
    quantityBase: basis.quantityBase + quantityBase,
    costUsdMicros: basis.costUsdMicros + costUsdMicros,
  };
}

/**
 * Removes units sold and realizes their proceeds minus their share of the cost (decision 0058).
 *
 * - The cost that leaves is the position's cost times the share of units sold, rounded up, so a
 *   gain is never overstated; the last unit takes all the cost that is left.
 * - Units beyond what the position holds came from outside its executions, such as a deposit or a
 *   paper starting balance, at a cost binference never saw. They leave at their own proceeds,
 *   with no gain or loss; the proceeds of the units held round down.
 * - Selling no units changes nothing.
 */
export function dispose(
  basis: CostBasis,
  quantityBase: bigint,
  proceedsUsdMicros: bigint,
): CostBasis {
  assertNotNegative([quantityBase, proceedsUsdMicros]);
  if (quantityBase === 0n) {
    return basis;
  }
  const held = basis.quantityBase;
  const covered = quantityBase < held ? quantityBase : held;
  const costOut =
    covered === held
      ? basis.costUsdMicros
      : mulDiv(basis.costUsdMicros, { numerator: covered, denominator: held }, "up");
  const proceedsIn = mulDiv(
    proceedsUsdMicros,
    { numerator: covered, denominator: quantityBase },
    "down",
  );
  return {
    quantityBase: held - covered,
    costUsdMicros: basis.costUsdMicros - costOut,
    realizedUsdMicros: basis.realizedUsdMicros + proceedsIn - costOut,
  };
}
