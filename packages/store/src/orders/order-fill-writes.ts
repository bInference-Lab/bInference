// The order fill rows: written beside a skip, or inside the move of the intent that filled.
import type { DatabaseSync } from "node:sqlite";
import { BinferenceError } from "@binference/core";
import {
  type FillAnnouncement,
  type OrderFillQuery,
  type OrderFillRecord,
  type OrderFillWrite,
  orderFillRecordSchema,
  recordsOwnFill,
  type UnannouncedFillQuery,
} from "@binference/engine/orders";
import type { Selectable } from "kysely";
import type { EngineTables } from "../databases/engine-tables.js";
import type { OrderFillsTable } from "../databases/order-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, jsonField, optionalJsonText, orNull } from "../rows/column-values.js";

function toOrderFillRecord(row: Selectable<OrderFillsTable>): OrderFillRecord {
  return orderFillRecordSchema.parse({
    id: row.id,
    orderId: row.order_id,
    ...field("intentId", row.intent_id),
    outcome: row.outcome,
    ...field("reason", row.reason),
    atMs: row.at,
    ...jsonField("notices", row.notices),
    ...field("announcedAtMs", row.announced_at),
  });
}

/** The `filled` row that counts an intent's fill, if any: a fill counts once (decision 0211). */
export function countedFillOf(database: DatabaseSync, intent: string): OrderFillRecord | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(
    kysely
      .selectFrom("order_fills")
      .selectAll()
      .where("intent_id", "=", intent)
      .where("outcome", "=", "filled"),
  );
  return row === undefined ? undefined : toOrderFillRecord(row);
}

/** Whether an intent has a `filled` row already. */
export function isCounted(database: DatabaseSync, intent: string): boolean {
  return countedFillOf(database, intent) !== undefined;
}

/**
 * Checks a fill row before anything of its write is written: a new id, a stored order and, when
 * it names one, a stored intent, and no second `filled` row for one intent. A broken rule throws
 * `store.constraint`, which rolls the write back.
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
  const isTwice =
    fill.outcome === "filled" && intentId !== undefined && isCounted(database, intentId);
  if (taken !== undefined || order === undefined || intent === undefined || isTwice) {
    throw new BinferenceError({
      code: "store.constraint",
      message: "A fill row takes a new id, names a stored order and intent, and counts once.",
      details: { fill: fill.id },
    });
  }
}

/**
 * Checks that a `filled` row comes with its own order's move to one fill more than the order has
 * stored (decision 0197); one without it throws `store.constraint`, which rolls the write back.
 */
export function checkOwnFill(database: DatabaseSync, write: OrderFillWrite): void {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const stored = takeFirst(
    kysely.selectFrom("orders").select("fills").where("id", "=", write.fill.orderId),
  );
  if (!recordsOwnFill(write, stored?.fills ?? 0)) {
    throw new BinferenceError({
      code: "store.constraint",
      message: "A fill lands only with its order's own move to one fill more.",
      details: { fill: write.fill.id },
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
      notices: optionalJsonText(fill.notices === undefined ? undefined : [...fill.notices]),
      announced_at: orNull(fill.announcedAtMs),
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

/** The rows of every order whose notices were never announced, the oldest first, then by id. */
export function listUnannounced(
  database: DatabaseSync,
  query: UnannouncedFillQuery,
): readonly OrderFillRecord[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const select = kysely
    .selectFrom("order_fills")
    .selectAll()
    .where("notices", "is not", null)
    .where("announced_at", "is", null)
    .orderBy("at")
    .orderBy("id")
    .limit(query.limit);
  return execute(select).rows.map(toOrderFillRecord);
}

/**
 * Marks rows' notices announced, keeping an earlier time. An unknown row, or one with no notices,
 * throws `store.constraint` before any row changes.
 */
export function markAnnounced(database: DatabaseSync, announcement: FillAnnouncement): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const ids = [...new Set(announcement.ids)];
  const known = execute(
    kysely
      .selectFrom("order_fills")
      .select("id")
      .where("id", "in", ids)
      .where("notices", "is not", null),
  ).rows;
  if (known.length !== ids.length) {
    throw new BinferenceError({
      code: "store.constraint",
      message: "An announcement names only stored rows with notices.",
      details: { rows: ids.length },
    });
  }
  execute(
    kysely
      .updateTable("order_fills")
      .set({ announced_at: announcement.atMs })
      .where("id", "in", ids)
      .where("announced_at", "is", null),
  );
}
