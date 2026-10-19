import { failureReasons } from "../intents/intent-reason.js";
import type { OrderFillReason, OrderFillRecord } from "./order-fill.js";
import { isExitOrder, type OrderRecord } from "./order-record.js";

/** How long a buy waits after its first skip in a row before its trigger may fill again. */
export const firstFillWaitMs = 15_000;
/** The longest a buy waits after a skip: the wait doubles up to it. */
export const longestFillWaitMs = 300_000;
/** How many of an order's newest fill rows its pace reads: enough skips to reach the longest wait. */
export const paceRows = 12;
/** On-chain failures since its last fill after which an exit order waits as a buy does. */
const backOffAfterFailures = 2;
/** On-chain failures since its last fill after which an order stops (decision 0211). */
export const stopAfterFailures = 5;

const chainFailures: ReadonlySet<string> = new Set<string>(failureReasons);

/**
 * How many of an order's fills failed on chain since its last fill, from its rows, newest first:
 * reverted, cancelled or dropped while stuck, its nonce taken, or a step never sent after an
 * earlier one landed.
 */
export function chainFailuresInRow(rows: readonly OrderFillRecord[]): number {
  const filled = rows.findIndex(({ outcome }) => outcome === "filled");
  const since = filled === -1 ? rows : rows.slice(0, filled);
  return since.filter(({ reason }) => reason !== undefined && chainFailures.has(reason)).length;
}

// How long after its last row an order waits after `skips` skips: 15 s, doubling up to 5 min.
function waitAfter(skips: number): number {
  return Math.min(firstFillWaitMs * 2 ** (skips - 1), longestFillWaitMs);
}

// The skips at the head of the rows, newest first, up to the last fill.
function skipsInRow(rows: readonly OrderFillRecord[]): number {
  const filled = rows.findIndex(({ outcome }) => outcome === "filled");
  return filled === -1 ? rows.length : filled;
}

/**
 * Whether an order still waits after its skips in a row (decision 0197), read from its fill rows,
 * newest first, so a restart keeps the wait. An exit order tries again at the next price, until
 * its second fill since its last fill failed on chain: then it waits 15 seconds, doubling with each
 * failure up to 5 minutes (decision 0211); so does a DCA order, whose period paces its buys
 * (decision 0246), and a copy order, whose leader paces its trades (decision 0260). Another buy
 * waits 15 seconds after its last skip, the wait doubling with each skip in a row up to 5 minutes;
 * a fill starts it over.
 */
export function isWaiting(
  order: Pick<OrderRecord, "request">,
  rows: readonly OrderFillRecord[],
  nowMs: number,
): boolean {
  const [last] = rows;
  const failures = chainFailuresInRow(rows);
  // A DCA order's period paces its buys, and a copy order's leader its trades, so each waits only
  // after fills failed on chain, as an exit order does (decisions 0246 and 0260).
  const { kind } = order.request;
  const byFailures = isExitOrder(order.request) || kind === "dca" || kind === "copy";
  const skips = byFailures ? failures - backOffAfterFailures + 1 : skipsInRow(rows);
  return last !== undefined && skips > 0 && nowMs < last.atMs + waitAfter(skips);
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
