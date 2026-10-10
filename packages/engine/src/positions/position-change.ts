import type { AssetRef } from "@binference/chain";
import type { Id } from "@binference/core";
import type { CostBasis } from "./average-cost.js";
import type { PositionKey, PositionRecord, PositionWrite } from "./position-record.js";

/** One asset's position as a change leaves it, with the stored row it started from. */
export interface PositionChange {
  readonly asset: AssetRef;
  readonly basis: CostBasis;
  readonly held: PositionRecord | undefined;
}

/** Where and when positions change: one wallet, paper or live, at one time. */
export interface PositionMove {
  readonly walletId: Id<"wal">;
  readonly isPaper: boolean;
  readonly atMs: number;
}

/** The stored row of one position, or `undefined` when it has none. */
export function heldPosition(
  held: readonly PositionRecord[],
  key: PositionKey,
): PositionRecord | undefined {
  return held.find(
    (position) =>
      position.walletId === key.walletId &&
      position.asset === key.asset &&
      position.isPaper === key.isPaper,
  );
}

/**
 * Whether a change leaves no row behind: an asset the positions never held, such as a coin that
 * arrived with no price, still holding nothing and having realized nothing.
 */
export function isEmptyChange({ basis, held }: PositionChange): boolean {
  return (
    held === undefined &&
    basis.quantityBase === 0n &&
    basis.costUsdMicros === 0n &&
    basis.realizedUsdMicros === 0n
  );
}

/** The write that stores a change under the row version it read; a new row carries none. */
export function positionWriteOf(move: PositionMove, change: PositionChange): PositionWrite {
  const { asset, basis, held } = change;
  return {
    position: {
      walletId: move.walletId,
      asset,
      isPaper: move.isPaper,
      quantityBase: basis.quantityBase,
      costUsdMicros: basis.costUsdMicros,
      realizedUsdMicros: basis.realizedUsdMicros,
      changedAtMs: Math.max(held?.changedAtMs ?? 0, move.atMs),
    },
    ...(held === undefined ? {} : { readVersion: held.version }),
  };
}

/**
 * What position writes realize: the change each makes to its position's realized P&L, from the
 * stored row in `held` it was computed from, or from nothing for a new row; below zero for a loss.
 */
export function realizedBy(
  held: readonly PositionRecord[],
  writes: readonly PositionWrite[],
): bigint {
  return writes.reduce(
    (total, { position }) =>
      total + position.realizedUsdMicros - (heldPosition(held, position)?.realizedUsdMicros ?? 0n),
    0n,
  );
}
