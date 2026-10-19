import type { ChainRegistry } from "@binference/chain";
import type { Clock } from "@binference/core";
import type { IntentStore } from "../ports.js";
import type { CopyOrder } from "./copy-fills.js";
import { copyOrdersIn } from "./copy-orders.js";
import { copyStateOf } from "./copy-state.js";
import { isLineHeld } from "./fill-faults.js";
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

// Whether a stop came between taking a trade and any row of its fill: no row since it was taken,
// and no live fill of the agent still on its way to one.
async function wasLost(parts: CopyRepairParts, order: CopyOrder, signal: AbortSignal) {
  const taking = copyStateOf(order.triggerState)?.taking;
  if (taking === undefined) {
    return false;
  }
  const [newest] = await parts.orders.fills({ orderId: order.id, limit: 1 }, { signal });
  if (newest !== undefined && newest.atMs >= taking.takenAtMs) {
    return false;
  }
  return !(await isLineHeld(parts, order, signal));
}

/**
 * The start's repair of copy orders (decision 0260): a leader trade a stop cut off between its
 * take and its fill is never copied, so no trade is copied twice; it is recorded now as `missed`,
 * once, and the owner hears of it. Answers how many trades it recorded.
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
