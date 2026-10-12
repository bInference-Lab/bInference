import {
  type OrderRecord,
  orderRecordSchema,
  orderRequestDocument,
} from "@binference/engine/orders";
import type { Selectable } from "kysely";
import type { OrdersTable } from "../databases/order-tables.js";
import { field, jsonField, jsonText, readJson } from "../rows/column-values.js";

/** An order's request as its `request` column stores it: amounts and prices as decimal text. */
export function requestText(request: OrderRecord["request"]): string {
  return jsonText(orderRequestDocument.encode(request));
}

/** Reads one `orders` row as its record. */
export function toOrderRecord(row: Selectable<OrdersTable>): OrderRecord {
  return orderRecordSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    walletId: row.wallet_id,
    kind: row.kind,
    state: row.state,
    request: readJson(row.request),
    ...jsonField("triggerState", row.trigger_state),
    fills: row.fills,
    ...field("maxFills", row.max_fills),
    expiresAtMs: row.expires_at,
    intentId: row.intent_id,
    ...field("cardId", row.card_id),
    isPaper: row.paper === 1,
    hasOutsideContent: row.outside_content === 1,
    ...field("endReason", row.end_reason),
    ...field("expiryNoticedAtMs", row.expiry_noticed_at),
    createdAtMs: row.created_at,
    changedAtMs: row.changed_at,
    version: row.version,
  });
}
