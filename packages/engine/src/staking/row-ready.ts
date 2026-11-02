import { accountRefParts } from "@binference/chain";
import type { StakingHost } from "../venues/staking-host.js";
import type { UnbondingRecord } from "./unbonding-record.js";

/**
 * Whether an unbonding's coin can be claimed now, as binference knows it (decision 0331): once its
 * time came, and for a live row of a liquid venue, whose own queue releases it, only once the owner
 * was told the venue released it. A paper row and a row of a venue of validators go by time alone.
 */
export function isRowReady(
  row: UnbondingRecord,
  context: { readonly nowMs: number; readonly staking: Pick<StakingHost, "venueOn"> },
): boolean {
  if (row.readyAtMs > context.nowMs) {
    return false;
  }
  if (row.isPaper || row.validator === undefined) {
    return true;
  }
  const venue = context.staking.venueOn(row.venue, accountRefParts(row.validator).chain);
  return venue?.pool === undefined || row.toldReadyAtMs !== undefined;
}
