import { applyBps, type Bps } from "@binference/core";

/**
 * What a sale of a share of a holding sells (spec 1, section 8.1): the share of what the wallet
 * holds, rounded down to a whole base unit. It never sells more than the holding, and sells less
 * than the exact share by less than one base unit; `10000` sells all of it.
 */
export function shareAmountBase(heldBase: bigint, percentBps: Bps): bigint {
  return heldBase <= 0n ? 0n : applyBps(heldBase, percentBps, "down");
}
