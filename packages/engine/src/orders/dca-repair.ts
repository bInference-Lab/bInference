import type { ChainRegistry } from "@binference/chain";
import type { Clock, Id } from "@binference/core";
import type { IntentStore } from "../ports.js";
import { periodOf } from "./dca-period.js";
import { isLineHeld } from "./fill-faults.js";
import type { OrderFills } from "./fill-orders.js";
import type { OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";
import { recordMissed } from "./record-missed.js";

/** What the start's repair of DCA periods reads and records through. */
export interface DcaRepairParts {
  readonly orders: OrderStore;
  readonly fills: Pick<OrderFills, "skip">;
  /** The agents' live fills still in flight, whose rows come as they settle. */
  readonly intents: Pick<IntentStore, "fillsInFlight">;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
}

const pageSize = 1_000;

async function runningDca(
  parts: DcaRepairParts,
  signal: AbortSignal,
  after?: { readonly createdAtMs: number; readonly id: Id<"ord"> },
): Promise<readonly OrderRecord[]> {
  const base = { states: ["active" as const, "paused" as const], limit: pageSize };
  const page = await parts.orders.list(after === undefined ? base : { ...base, after }, { signal });
  const last = page.at(-1);
  const dca = page.filter(({ kind }) => kind === "dca");
  if (last === undefined) {
    return dca;
  }
  return [
    ...dca,
    ...(await runningDca(parts, signal, { createdAtMs: last.createdAtMs, id: last.id })),
  ];
}

// Whether a stop came between keeping the period whose buy was handed on and any row of that buy:
// no row since its due time, and no live fill of the agent still on its way to one.
async function wasLost(parts: DcaRepairParts, order: OrderRecord, signal: AbortSignal) {
  const buying = periodOf(order.triggerState)?.buying;
  if (buying === undefined) {
    return false;
  }
  const [newest] = await parts.orders.fills({ orderId: order.id, limit: 1 }, { signal });
  if (newest !== undefined && newest.atMs >= buying) {
    return false;
  }
  return !(await isLineHeld(parts, order, signal));
}

/**
 * The start's repair of DCA periods (decision 0246): a period whose buy a stop cut off between
 * keeping it and its fill leaves no buy, never a second one; it is recorded now as `missed`, so
 * the owner hears of it. Answers how many periods it recorded.
 */
export async function repairDcaPeriods(
  parts: DcaRepairParts,
  options: { readonly signal: AbortSignal },
): Promise<number> {
  const { signal } = options;
  const orders = await runningDca(parts, signal);
  return recordMissed(parts.fills, {
    orders,
    wasLost: async (order) => wasLost(parts, order, signal),
    signal,
  });
}
