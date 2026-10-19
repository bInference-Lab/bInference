import type { ChainRegistry } from "@binference/chain";
import type { Clock } from "@binference/core";
import type { IntentStore } from "../ports.js";
import type { CopyOrder } from "./copy-fills.js";
import { copyOrdersIn } from "./copy-orders.js";
import { lostTakeOf } from "./copy-taken.js";
import type { OrderFills } from "./fill-orders.js";
import type { OrderStore } from "./ports.js";
import { recordMissed } from "./record-missed.js";

/** What the start's repair of copy orders reads and records through. */
export interface CopyRepairParts {
  readonly orders: OrderStore;
  readonly fills: Pick<OrderFills, "skip">;
  /** The agents' live fills still in flight, whose rows come as they settle. */
  readonly intents: Pick<IntentStore, "fillsInFlight">;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
}

// A buy a stop cut off between its take and its fill; a sale so cut off is the runner's to fill
// late (decision 0260).
async function wasLost(parts: CopyRepairParts, order: CopyOrder, signal: AbortSignal) {
  return (await lostTakeOf(parts, order, signal))?.side === "buy";
}

/**
 * The start's repair of copy orders (decision 0260): a leader buy a stop cut off between its take
 * and its fill is never bought, so no trade is copied twice; it is recorded now as `missed`, once,
 * and the owner hears of it. A sale so cut off is left to the runner, which sells it late, once.
 * Answers how many buys it recorded.
 */
export async function repairCopyTrades(
  parts: CopyRepairParts,
  options: { readonly signal: AbortSignal },
): Promise<number> {
  const { signal } = options;
  const orders = await copyOrdersIn(parts.orders, { states: ["active", "paused"], signal });
  return recordMissed(parts.fills, {
    orders,
    wasLost: async (order) => wasLost(parts, order, signal),
    signal,
  });
}
