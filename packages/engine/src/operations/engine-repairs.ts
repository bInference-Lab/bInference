import type { StoredIntents } from "../intents/create-stored-intents.js";
import { repairOrderFills } from "../orders/repair-order-fills.js";
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

/** The startup's repair of the order fills a stop left (decision 0197). */
export function orderRepairOf(
  options: EngineOptions,
  stored: StoredIntents,
): Engine["repairOrderFills"] {
  const { stores, clock, ids, publish } = options;
  return async (call) =>
    repairOrderFills({ stored, orders: stores.orders, clock, ids, publish }, call);
}
