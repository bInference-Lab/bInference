import type { OrderFillReason, OrderFillRecord } from "./order-fill.js";
import { isExitOrder, type OrderRecord } from "./order-record.js";

/** How long a buy waits after its first skip in a row before its trigger may fill again. */
export const firstFillWaitMs = 15_000;
/** The longest a buy waits after a skip: the wait doubles up to it. */
export const longestFillWaitMs = 300_000;
/** How many of an order's newest fill rows its pace reads: enough skips to reach the longest wait. */
export const paceRows = 6;

// The skips at the head of the rows, newest first, up to the last fill.
function skipsInRow(rows: readonly OrderFillRecord[]): number {
  const filled = rows.findIndex(({ outcome }) => outcome === "filled");
  return filled === -1 ? rows.length : filled;
}

/**
 * Whether an order still waits after its skips in a row (decision 0197), read from its fill rows,
 * newest first, so a restart keeps the wait. An exit order never waits: it tries again at the next
 * price. A buy waits 15 seconds after its last skip, the wait doubling with each skip in a row up
 * to 5 minutes; a fill starts it over.
 */
export function isWaiting(
  order: Pick<OrderRecord, "request">,
  rows: readonly OrderFillRecord[],
  nowMs: number,
): boolean {
  const skips = skipsInRow(rows);
  const [last] = rows;
  if (isExitOrder(order.request) || skips === 0 || last === undefined) {
    return false;
  }
  const waitMs = Math.min(firstFillWaitMs * 2 ** (skips - 1), longestFillWaitMs);
  return nowMs < last.atMs + waitMs;
}

/**
 * Whether a skip for this reason is new in a row for its order, so the owner hears it: the order's
 * last row is a fill, a skip for another reason, or none.
 */
export function isNewReason(rows: readonly OrderFillRecord[], reason: OrderFillReason): boolean {
  const [last] = rows;
  return last?.outcome !== "skipped" || last.reason !== reason;
}

/** The skip reasons the owner hears once per agent, whichever of its orders skips first. */
export const agentWideReasons: ReadonlySet<OrderFillReason> = new Set<OrderFillReason>([
  "engine_locked",
  "live_fills_off",
]);
