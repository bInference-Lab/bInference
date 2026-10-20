import type { StoredIntents } from "../intents/create-stored-intents.js";
import { repairDcaPeriods } from "../orders/dca-repair.js";
import type { OrderFills } from "../orders/fill-orders.js";
import { repairOrderFills } from "../orders/repair-order-fills.js";
import type { ResumeFence } from "../orders/resume-fence.js";
import type { PaperParts } from "../paper/paper-parts.js";
import { repairPaperFills } from "../paper/repair-paper-fills.js";
import type { Engine, EngineOptions } from "./create-engine.js";

/** The startup's repair of paper fills a crash left without positions. */
export function paperRepairOf(
  options: EngineOptions,
  parts: { readonly stored: StoredIntents; readonly paper: PaperParts },
): Engine["repairPaperFills"] {
  const repair = {
    intents: options.stores.intents,
    stored: parts.stored,
    store: options.positions,
    positions: parts.paper.positions,
    clock: options.clock,
  };
  return async (call) => repairPaperFills(repair, call);
}

/**
 * The startup's repair of the order fills a stop left (decision 0197), then of the DCA periods a
 * stop cut off between keeping them and their buy (decision 0246). A copy order's take a stop cut
 * off is ended by the copy runner, by its rows (decision 0260).
 */
export function orderRepairOf(
  options: EngineOptions,
  parts: {
    readonly stored: StoredIntents;
    readonly fills: OrderFills;
    /** The downtime re-check, whose one report tells a resume's skips. */
    readonly fence: ResumeFence;
  },
): Engine["repairOrderFills"] {
  const { stores, clock, ids, publish, chains } = options;
  const { stored, fills, fence } = parts;
  return async (call) => {
    const repaired = await repairOrderFills(
      { stored, orders: stores.orders, clock, ids, publish, fence },
      call,
    );
    const dca = { orders: stores.orders, fills, intents: stores.intents, chains, clock };
    return repaired + (await repairDcaPeriods(dca, call));
  };
}
