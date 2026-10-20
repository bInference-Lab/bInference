import type { Id } from "@binference/core";
import { bySkipCount, type FillCountQuery, type FillCounts } from "../orders/fill-counts.js";
import type { OrderFillReason, OrderFillRecord } from "../orders/order-fill.js";
import type { OrderRecord } from "../orders/order-record.js";

/** What the in-memory fill counts read: the orders and their fill rows. */
export interface FillCountSources {
  readonly orders: ReadonlyMap<Id<"ord">, OrderRecord>;
  readonly rows: readonly OrderFillRecord[];
}

/** The fills and skips of the query's agent's orders in its range, as the SQLite store counts them. */
export function fillCountsOf(sources: FillCountSources, query: FillCountQuery): FillCounts {
  const inRange = sources.rows.filter(
    (row) =>
      sources.orders.get(row.orderId)?.agentId === query.agentId &&
      row.atMs >= query.fromMs &&
      row.atMs < query.toMs,
  );
  const skips = new Map<OrderFillReason, number>();
  for (const { reason } of inRange) {
    if (reason !== undefined) {
      skips.set(reason, (skips.get(reason) ?? 0) + 1);
    }
  }
  return {
    filled: inRange.filter(({ outcome }) => outcome === "filled").length,
    skipped: [...skips]
      .map(([reason, count]: readonly [OrderFillReason, number]) => ({ reason, count }))
      .toSorted(bySkipCount),
  };
}
