/** The pool's slisBNB supply and the BNB it is worth together, at one block. */
export interface PoolTotals {
  readonly supply: bigint;
  readonly pooled: bigint;
}

// The stake manager counts an empty supply or pool as 1, so that neither division is by zero.
function guarded({ supply, pooled }: PoolTotals): PoolTotals {
  return { supply: supply === 0n ? 1n : supply, pooled: pooled === 0n ? 1n : pooled };
}

/** The slisBNB units a deposit of the coin mints, as `convertBnbToSnBnb` rounds it, down. */
export function unitsFor(coin: bigint, totals: PoolTotals): bigint {
  const { supply, pooled } = guarded(totals);
  return (coin * supply) / pooled;
}

/** The coin a request of the units takes out, as `convertSnBnbToBnb` rounds it, down. */
export function coinFor(units: bigint, totals: PoolTotals): bigint {
  const { supply, pooled } = guarded(totals);
  return (units * pooled) / supply;
}

/** The least coin whose deposit mints a unit: a smaller one mints none, which the stake manager refuses. */
export function leastStake(totals: PoolTotals): bigint {
  const { supply, pooled } = guarded(totals);
  return (pooled + supply - 1n) / supply;
}

// The least units a stake's card promises sit 10 basis points under what the plan's block mints:
// a deposit takes no least amount, and the pool's rewards lift the rate about 0.7 basis points a
// day, so the queue's new plan and the landing keep inside it (decision 0332).
const leastShareBps = 9_990n;

/** The least units a stake's card promises for the units its plan mints, never none. */
export function leastUnits(minted: bigint): bigint {
  const least = (minted * leastShareBps) / 10_000n;
  return least === 0n ? minted : least;
}
