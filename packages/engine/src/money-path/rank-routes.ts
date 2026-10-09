import { mulDiv, type Ratio } from "@binference/core";

/** What the best quote weighs of one route whose simulation passed. */
export interface RouteValue {
  /** What the simulation saw arrive, in base units of the asset bought: net of any transfer tax. */
  readonly receivedBase: bigint;
  /** The network fee of the route's steps, in base units of the asset bought. */
  readonly gasBase: bigint;
}

/**
 * The network fee of a route's steps in the asset bought: the gas they used, at the fee per gas,
 * converted at `nativeToAssetOut`, rounded up so a route's cost is never understated. Without a
 * rate, when neither side of the trade has a price, the fee is not counted and routes rank by what
 * they receive alone.
 */
export function gasInAssetOut(
  gasUsed: bigint,
  feePerGasBase: bigint,
  nativeToAssetOut: Ratio | undefined,
): bigint {
  return nativeToAssetOut === undefined
    ? 0n
    : mulDiv(gasUsed * feePerGasBase, nativeToAssetOut, "up");
}

/**
 * The routes' places in `values`, best first: the most received net of the network fee. Routes
 * worth the same keep their order, the agent's venue order, so the first venue wins a tie.
 */
export function rankRoutes(values: readonly RouteValue[]): readonly number[] {
  const netOf = (index: number): bigint => {
    const value = values[index];
    return value === undefined ? 0n : value.receivedBase - value.gasBase;
  };
  return values
    .map((_value, index) => index)
    .toSorted((left, right) => {
      const difference = netOf(right) - netOf(left);
      if (difference === 0n) {
        return left - right;
      }
      return difference > 0n ? 1 : -1;
    });
}
