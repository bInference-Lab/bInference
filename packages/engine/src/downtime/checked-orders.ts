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

// The order's rows since the re-check's first resume, the oldest first.
async function rowsSince(parts: RowsParts, call: OrderCall): Promise<readonly OrderFillRecord[]> {
  const { base, open, signal } = call;
  const rows = await parts.orders.fills({ orderId: base.order, limit: parts.rows }, { signal });
  return rows.filter(({ atMs }) => atMs >= open.sinceMs).toReversed();
}

function skipped(
  base: OrderCall["base"],
  skip: { readonly reason: CheckedSkipReason; readonly row?: OrderFillRecord },
): CheckedOrder {
  const part = skip.row === undefined ? undefined : reasonPartOf(skip.row);
  const reason = { outcome: "skipped", reason: skip.reason } as const;
  return part === undefined ? { ...base, ...reason } : { ...base, ...reason, reasonPart: part };
}

// A price order whose fill skipped: the reason of the skip row the re-check held, else of its
// newest skip row since the resume.
async function fillSkipOf(parts: RowsParts, call: OrderCall): Promise<CheckedOrder> {
  const held = call.open.held.get(call.base.order);
  const rows = held === undefined ? await rowsSince(parts, call) : [held];
  const row = rows.findLast(({ outcome }) => outcome === "skipped");
  return row?.reason === undefined
    ? skipped(call.base, { reason: "fill_failed" })
    : skipped(call.base, { reason: row.reason, row });
}

// A price order's outcome: its judgment and fill; one never judged is `no_fresh_price` while it
// is still active, and leaves the report else.
async function priceOutcome(parts: RowsParts, call: OrderCall): Promise<CheckedOrder | undefined> {
  const { base, watched, signal } = call;
  const { standing } = watched;
  if (standing.state === "filled") {
    return { ...base, outcome: "filled" };
  }
  if (standing.state === "firing") {
    return skipped(base, { reason: "fill_failed" });
  }
  if (standing.state === "skipped") {
    return standing.fromRow === true
      ? fillSkipOf(parts, call)
      : skipped(base, { reason: standing.reason });
  }
  const order = await parts.orders.get(base.order, { signal });
  return order?.state === "active" ? skipped(base, { reason: "no_fresh_price" }) : undefined;
}

// A DCA or copy order's outcome: its first skip of the downtime, which the report always shows,
// though a fill of the order came too, since that fill tells itself.
async function rowOutcome(parts: RowsParts, call: OrderCall): Promise<CheckedOrder | undefined> {
  const rows = await rowsSince(parts, call);
  const row = rows.find(
    ({ outcome, reason }) => outcome === "skipped" && downtimeRowReasons.has(reason ?? ""),
  );
  return row?.reason === undefined ? undefined : skipped(call.base, { reason: row.reason, row });
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
