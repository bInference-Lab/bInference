import { BinferenceError } from "@binference/core";
import type { ArrivalDraft } from "./arrival-record.js";
import { acquire, emptyCostBasis } from "./average-cost.js";
import { heldPosition, positionWriteOf } from "./position-change.js";
import type { PositionRecord, PositionWrite } from "./position-record.js";

/**
 * The position change funds that arrived without a trade make, at average cost (decision 0058).
 * `held` holds the wallet's stored positions; an asset without one starts empty, and its write
 * carries no `readVersion`.
 *
 * - A valued arrival opens or adds to its asset's position: the units, at their value when they
 *   arrived. A later sale realizes the difference from that value.
 * - An arrival with no value (no usable price when it arrived) changes no position. binference
 *   never guesses a cost: a later sale of those units counts no gain or loss, as a sale of funds
 *   binference never saw arrive does (see `dispose`).
 *
 * Throws `positions.bad_arrival` for an arrival of no units.
 */
export function applyArrival(
  held: readonly PositionRecord[],
  arrival: ArrivalDraft,
): readonly PositionWrite[] {
  const { walletId, isPaper, received, valueUsdMicros } = arrival;
  if (received.base <= 0n) {
    throw new BinferenceError({
      code: "positions.bad_arrival",
      message: "An arrival brings some units of an asset.",
      details: { wallet: walletId },
    });
  }
  if (valueUsdMicros === undefined) {
    return [];
  }
  const record = heldPosition(held, { walletId, asset: received.asset, isPaper });
  const basis = acquire(record ?? emptyCostBasis, received.base, valueUsdMicros);
  return [positionWriteOf(arrival, { asset: received.asset, basis, held: record })];
}
