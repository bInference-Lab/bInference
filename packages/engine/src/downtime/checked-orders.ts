import type { Id } from "@binference/core";
import type { OrderFillRecord } from "../orders/order-fill.js";
import { hasPriceTrigger } from "../orders/order-record.js";
import type { OrderStore } from "../orders/ports.js";
import { type NoticePart, noticeSchema } from "../pushes/notice-push.js";
import {
  type CheckedSkipReason,
  downtimeRowReasons,
  type OpenCheck,
  type WatchedOrder,
} from "./downtime-check.js";
import type { CheckedOrder } from "./downtime-report.js";

/** What the report reads each order's rows through, and how many of its newest rows. */
interface RowsParts {
  readonly orders: Pick<OrderStore, "get" | "fills">;
  readonly rows: number;
}

/** One order the report finds the outcome of, in the re-check it belongs to. */
interface OrderCall {
  readonly base: Pick<CheckedOrder, "order" | "agentId" | "kind">;
  readonly watched: WatchedOrder;
  readonly open: OpenCheck;
  readonly signal: AbortSignal;
}

// The reason part a skip row's own notice carried, which holds a cap's use and size.
function reasonPartOf(row: OrderFillRecord): NoticePart | undefined {
  const [first] = row.notices ?? [];
  const parsed = first === undefined ? undefined : noticeSchema.safeParse(first);
  return parsed?.success === true ? parsed.data.parts?.["reason"] : undefined;
}

// The order's skip rows since the re-check's first resume, the oldest first.
async function skipsSince(parts: RowsParts, call: OrderCall): Promise<readonly OrderFillRecord[]> {
  const { base, open, signal } = call;
  const rows = await parts.orders.fills({ orderId: base.order, limit: parts.rows }, { signal });
  return rows
    .filter(({ atMs, outcome }) => atMs >= open.sinceMs && outcome === "skipped")
    .toReversed();
}

function skipped(
  base: OrderCall["base"],
  skip: { readonly reason: CheckedSkipReason; readonly row?: OrderFillRecord },
): CheckedOrder {
  const part = skip.row === undefined ? undefined : reasonPartOf(skip.row);
  const reason = { outcome: "skipped", reason: skip.reason } as const;
  return part === undefined ? { ...base, ...reason } : { ...base, ...reason, reasonPart: part };
}

// A skip row's outcome: its reason, and how its own notice wrote it.
function rowSkip(call: OrderCall, row: OrderFillRecord): CheckedOrder {
  return skipped(call.base, { reason: row.reason ?? "fill_failed", row });
}

type Judged = Extract<WatchedOrder["standing"], { readonly state: "firing" | "skipped" }>;

// A price order never judged: a skip row the start's repair wrote, as for a fill a stop cut off,
// else `no_fresh_price` while it is still active; an order no longer active leaves the report.
async function pendingOutcome(
  parts: RowsParts,
  call: OrderCall,
  rows: readonly OrderFillRecord[],
): Promise<CheckedOrder | undefined> {
  const [repaired] = rows;
  if (repaired !== undefined) {
    return rowSkip(call, repaired);
  }
  const order = await parts.orders.get(call.base.order, { signal: call.signal });
  return order?.state === "active" ? skipped(call.base, { reason: "no_fresh_price" }) : undefined;
}

// A price order judged on a fresh price: a skip row written before the judgment, else a fill
// that never ended is `fill_failed`, else its skip's own row or the judgment's reason.
function judgedOutcome(
  call: OrderCall,
  rows: readonly OrderFillRecord[],
  standing: Judged,
): CheckedOrder {
  const repaired = rows.find(({ atMs }) => atMs < standing.atMs);
  if (repaired !== undefined) {
    return rowSkip(call, repaired);
  }
  if (standing.state === "firing") {
    return skipped(call.base, { reason: "fill_failed" });
  }
  const own =
    standing.fromRow === true ? rows.findLast(({ atMs }) => atMs >= standing.atMs) : undefined;
  return own === undefined ? skipped(call.base, { reason: standing.reason }) : rowSkip(call, own);
}

// A price order's outcome: its first fresh judgment and the fill it started (decision 0267).
async function priceOutcome(parts: RowsParts, call: OrderCall): Promise<CheckedOrder | undefined> {
  const { standing } = call.watched;
  if (standing.state === "filled" || standing.state === "sent") {
    return { ...call.base, outcome: standing.state };
  }
  const rows = await skipsSince(parts, call);
  return standing.state === "pending"
    ? pendingOutcome(parts, call, rows)
    : judgedOutcome(call, rows, standing);
}

// A DCA or copy order's outcome: its first skip of the downtime, which the report always shows,
// though a fill of the order came too, since that fill tells itself.
async function rowOutcome(parts: RowsParts, call: OrderCall): Promise<CheckedOrder | undefined> {
  const rows = await skipsSince(parts, call);
  const row = rows.find(({ reason }) => downtimeRowReasons.has(reason ?? ""));
  return row === undefined ? undefined : rowSkip(call, row);
}

async function outcomeOf(parts: RowsParts, call: OrderCall): Promise<CheckedOrder | undefined> {
  return hasPriceTrigger(call.watched.kind) ? priceOutcome(parts, call) : rowOutcome(parts, call);
}

/**
 * What the re-check found of each order it took (decision 0267): every price order still in it,
 * and each DCA or copy order a skip of the downtime landed for, in the order the re-check took
 * them.
 */
export async function checkedOrdersOf(
  parts: RowsParts,
  open: OpenCheck,
  signal: AbortSignal,
): Promise<readonly CheckedOrder[]> {
  const calls: readonly OrderCall[] = [...open.orders].map(
    ([order, watched]: readonly [Id<"ord">, WatchedOrder]) => ({
      base: { order, agentId: watched.agentId, kind: watched.kind },
      watched,
      open,
      signal,
    }),
  );
  const outcomes = await Promise.all(calls.map(async (call) => outcomeOf(parts, call)));
  return outcomes.filter((outcome) => outcome !== undefined);
}
