import type { Id } from "@binference/core";
import type { CopyOrderRequest } from "@binference/protocol";
import type { IntentRecord } from "../intents/intent-record.js";
import type { CopyBuyQuery, CopyBuyRecord, OrderFillRecord } from "../orders/order-fill.js";
import type { OrderRecord } from "../orders/order-record.js";
import { constraintFault } from "./memory-call.js";

/** What the in-memory copy buys read: the orders, their fill rows and the intents beside them. */
export interface CopyBuySources {
  readonly orders: ReadonlyMap<Id<"ord">, OrderRecord>;
  /** Every fill row, in the order they were written. */
  readonly rows: readonly OrderFillRecord[];
  readonly intentNow: ((intent: Id<"int">) => IntentRecord | undefined) | undefined;
}

// The request of the query's agent's copy order of its leader a row is of; none for another row.
function copyRequestOf(
  sources: CopyBuySources,
  query: CopyBuyQuery,
  row: OrderFillRecord,
): CopyOrderRequest | undefined {
  const order = sources.orders.get(row.orderId);
  const request = order?.agentId === query.agentId ? order.request : undefined;
  return request?.kind === "copy" && request.trigger.leader === query.leader ? request : undefined;
}

// The copy buy a row records for the query's agent and leader; none for any other row.
function copyBuyOf(
  sources: CopyBuySources,
  query: CopyBuyQuery,
  row: OrderFillRecord,
): CopyBuyRecord | undefined {
  const request = copyRequestOf(sources, query, row);
  const intent = row.intentId === undefined ? undefined : sources.intentNow?.(row.intentId);
  const isBuy = row.outcome === "filled" && intent?.kind === "buy" && row.atMs >= query.fromMs;
  if (request === undefined || !isBuy) {
    return undefined;
  }
  const usdMicros = intent.valueUsdMicros ?? request.trigger.perBuyUsdMicros;
  return { id: row.id, atMs: row.atMs, usdMicros };
}

// The rows written after the page before's last, which must be a stored row.
function rowsAfter(
  rows: readonly OrderFillRecord[],
  after: CopyBuyQuery["after"],
): readonly OrderFillRecord[] {
  if (after === undefined) {
    return rows;
  }
  const at = rows.findIndex((row) => row.id === after);
  if (at === -1) {
    throw constraintFault(`a page of copy buys starts after ${after}, which is not stored`);
  }
  return rows.slice(at + 1);
}

/** An agent's copy buys of one leader from a time on, in the order they were written, paged. */
export function copyBuysOf(sources: CopyBuySources, query: CopyBuyQuery): readonly CopyBuyRecord[] {
  return rowsAfter(sources.rows, query.after)
    .flatMap((row) => copyBuyOf(sources, query, row) ?? [])
    .slice(0, query.limit);
}
