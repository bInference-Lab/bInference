// The order fill rows: written beside a skip, or inside the move of the intent that filled.
import type { DatabaseSync } from "node:sqlite";
import { BinferenceError } from "@binference/core";
import {
  type OrderFillQuery,
  type OrderFillRecord,
  orderFillRecordSchema,
} from "@binference/engine/orders";
import type { Selectable } from "kysely";
import type { EngineTables } from "../databases/engine-tables.js";
import type { OrderFillsTable } from "../databases/order-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, orNull } from "../rows/column-values.js";

function toOrderFillRecord(row: Selectable<OrderFillsTable>): OrderFillRecord {
  return orderFillRecordSchema.parse({
    id: row.id,
    orderId: row.order_id,
    ...field("intentId", row.intent_id),
    outcome: row.outcome,
    ...field("reason", row.reason),
    atMs: row.at,
  });
}

/**
 * Checks a fill row before anything of its write is written: a new id, a stored order and, when
 * it names one, a stored intent. A broken rule throws `store.constraint`, which rolls the write
 * back.
 */
export function checkOrderFill(database: DatabaseSync, fill: OrderFillRecord): void {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const taken = takeFirst(kysely.selectFrom("order_fills").select("id").where("id", "=", fill.id));
  const order = takeFirst(kysely.selectFrom("orders").select("id").where("id", "=", fill.orderId));
  const { intentId } = fill;
  const intent =
    intentId === undefined
      ? { id: intentId }
      : takeFirst(kysely.selectFrom("intents").select("id").where("id", "=", intentId));
  if (taken !== undefined || order === undefined || intent === undefined) {
    throw new BinferenceError({
      code: "store.constraint",
      message: "A fill row takes a new id and names a stored order and intent.",
      details: { fill: fill.id },
    });
  }
}

/** Writes a fill row `checkOrderFill` passed, and answers it as stored. */
export function insertOrderFill(database: DatabaseSync, fill: OrderFillRecord): OrderFillRecord {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely.insertInto("order_fills").values({
      id: fill.id,
      order_id: fill.orderId,
      intent_id: orNull(fill.intentId),
      outcome: fill.outcome,
      reason: orNull(fill.reason),
      at: fill.atMs,
    }),
  );
  return fill;
}

/** One order's fill rows, the newest first, then by id from the last. */
export function listOrderFills(
  database: DatabaseSync,
  query: OrderFillQuery,
): readonly OrderFillRecord[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const select = kysely
    .selectFrom("order_fills")
    .selectAll()
    .where("order_id", "=", query.orderId)
    .orderBy("at", "desc")
    .orderBy("id", "desc")
    .limit(query.limit);
  return execute(select).rows.map(toOrderFillRecord);
}
