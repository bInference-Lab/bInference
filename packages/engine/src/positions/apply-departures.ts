import type { Amount } from "@binference/chain";
import { BinferenceError, type Id } from "@binference/core";
import { emptyCostBasis, withdraw } from "./average-cost.js";
import type { DepartureDraft } from "./departure-record.js";
import {
  heldPosition,
  isEmptyChange,
  type PositionChange,
  positionWriteOf,
} from "./position-change.js";
import type { PositionRecord, PositionWrite } from "./position-record.js";

/** A live position some departures change, and the latest time one of them left. */
interface Touched extends PositionChange {
  readonly walletId: Id<"wal">;
  readonly atMs: number;
}

function assertSent(departure: DepartureDraft): void {
  if (departure.sent.base <= 0n) {
    throw new BinferenceError({
      code: "positions.bad_departure",
      message: "A departure sends some units of an asset.",
      details: { wallet: departure.walletId },
    });
  }
}

/**
 * The live position changes one intent's departures make, at average cost (decision 0127), in the
 * order the departures touch the positions. `held` holds the stored live positions of every wallet
 * the departures leave; an asset without one starts empty, and its write carries no `readVersion`.
 *
 * - The units sent leave their asset's position at average cost, with no gain or loss.
 * - The gas leaves the native coin's position the same way.
 * - Units beyond what a position holds take no cost, and an asset no position holds gets no row.
 *
 * Throws `positions.bad_departure` for a departure that sends no units.
 */
export function applyDepartures(
  held: readonly PositionRecord[],
  departures: readonly DepartureDraft[],
): readonly PositionWrite[] {
  const touched = new Map<string, Touched>();
  const change = ({ walletId, atMs }: DepartureDraft, gone: Amount): void => {
    const key = `${walletId} ${gone.asset}`;
    const record = heldPosition(held, { walletId, asset: gone.asset, isPaper: false });
    const entry = touched.get(key) ?? {
      walletId,
      asset: gone.asset,
      basis: record ?? emptyCostBasis,
      held: record,
      atMs,
    };
    const basis = withdraw(entry.basis, gone.base);
    touched.set(key, { ...entry, basis, atMs: Math.max(entry.atMs, atMs) });
  };
  for (const departure of departures) {
    assertSent(departure);
    change(departure, departure.sent);
    if (departure.gas.base > 0n) {
      change(departure, departure.gas);
    }
  }
  return [...touched.values()]
    .filter((entry) => !isEmptyChange(entry))
    .map((entry) => positionWriteOf({ ...entry, isPaper: false }, entry));
}
