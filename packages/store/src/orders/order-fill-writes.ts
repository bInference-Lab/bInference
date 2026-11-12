// The order fill rows: written beside a skip, or inside the move of the intent that filled.

import { BinferenceError, err, ok, type Result } from "@binference/core";
import {
  type FillAnnouncement,
  type OrderFillQuery,
  type OrderFillRecord,
  type OrderFillWrite,
  orderFillRecordSchema,
  recordsOwnFill,
  type UnannouncedFillQuery,
} from "@binference/engine/orders";
import type { Insertable, Selectable } from "kysely";
import type { EngineTables } from "../databases/engine-tables.js";
import type { OrderFillsTable } from "../databases/order-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, jsonField, optionalJsonText, orNull } from "../rows/column-values.js";
import { checkOrderMoves } from "./order-writes.js";

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
    ...(row.copy_trade === null || row.copy_take === null
      ? {}
      : { copy: { trade: row.copy_trade, take: row.copy_take } }),
  });
}

/** The `filled` row that counts an intent's fill, if any: a fill counts once (decision 0211). */
export function countedFillOf(
  database: StoreConnection,
  intent: string,
): OrderFillRecord | undefined {
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
export function isCounted(database: StoreConnection, intent: string): boolean {
  return countedFillOf(database, intent) !== undefined;
}

/**
 * Checks a fill row before anything of its write is written: a new id, a stored order and, when
 * it names one, a stored intent, and no second `filled` row for one intent. A broken rule throws
 * `store.constraint`, which rolls the write back.
 */
export function checkOrderFill(database: StoreConnection, fill: OrderFillRecord): void {
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

// A `filled` row comes with its own order's move to one fill more than the order has stored
// (decision 0197); one without it throws `store.constraint`, which rolls the write back.
function checkOwnFill(database: StoreConnection, write: OrderFillWrite): void {
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

/**
 * Checks a fill's write on its order before anything of it is written, for each write that counts
 * one (a landed fill, the intent move that carries one, a late landing): its row, then its moves
 * under their versions, then its order's own move to one fill more. A move behind its order's
 * version is `stale`, so a writer that lost the order to another fill reads it again; only a write
 * that read the order as it stands is judged by its count. A broken rule throws `store.constraint`.
 */
export function checkOrderFillWrite(
  database: StoreConnection,
  write: OrderFillWrite,
): Result<undefined, "stale"> {
  checkOrderFill(database, write.fill);
  if (!checkOrderMoves(database, write.moves).ok) {
    return err("stale");
  }
  checkOwnFill(database, write);
  return ok(undefined);
}

// A fill row's columns, but its write-order number, which the insert trigger takes.
function fillColumnsOf(fill: OrderFillRecord): Insertable<OrderFillsTable> {
  return {
    id: fill.id,
    order_id: fill.orderId,
    intent_id: orNull(fill.intentId),
    outcome: fill.outcome,
    reason: orNull(fill.reason),
    at: fill.atMs,
    notices: optionalJsonText(fill.notices === undefined ? undefined : [...fill.notices]),
    announced_at: orNull(fill.announcedAtMs),
    copy_trade: orNull(fill.copy?.trade),
    copy_take: orNull(fill.copy?.take),
  };
}

/** Writes a fill row `checkOrderFill` passed, and answers it as stored. */
export function insertOrderFill(database: StoreConnection, fill: OrderFillRecord): OrderFillRecord {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(kysely.insertInto("order_fills").values(fillColumnsOf(fill)));
  return fill;
}

/**
 * Whether the stored row under `fill`'s id holds exactly `fill`, however its notices were told
 * since: the same write that counted it run again (decision 0413).
 */
export function holdsFill(database: StoreConnection, fill: OrderFillRecord): boolean {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(kysely.selectFrom("order_fills").selectAll().where("id", "=", fill.id));
  const stored: Readonly<Record<string, string | number | null>> | undefined = row;
  const expected: Readonly<Record<string, string | number | null | undefined>> =
    fillColumnsOf(fill);
  return (
    stored !== undefined &&
    Object.keys(expected)
      .filter((column) => column !== "announced_at")
      .every((column) => stored[column] === expected[column])
  );
}

/** One order's fill rows, the newest first, then the last written first (decision 0366). */
export function listOrderFills(
  database: StoreConnection,
  query: OrderFillQuery,
): readonly OrderFillRecord[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const select = kysely
    .selectFrom("order_fills")
    .selectAll()
    .where("order_id", "=", query.orderId)
    .orderBy("at", "desc")
    .orderBy("seq", "desc")
    .limit(query.limit);
  return execute(select).rows.map(toOrderFillRecord);
}

/**
 * The rows of every order whose notices were never announced, the oldest first, then in the order
 * they were written (decision 0366).
 */
export function listUnannounced(
  database: StoreConnection,
  query: UnannouncedFillQuery,
): readonly OrderFillRecord[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const select = kysely
    .selectFrom("order_fills")
    .selectAll()
    .where("notices", "is not", null)
    .where("announced_at", "is", null)
    .orderBy("at")
    .orderBy("seq")
    .limit(query.limit);
  return execute(select).rows.map(toOrderFillRecord);
}

/**
 * Marks rows' notices announced, keeping an earlier time. An unknown row, or one with no notices,
 * throws `store.constraint` before any row changes.
 */
export function markAnnounced(database: StoreConnection, announcement: FillAnnouncement): void {
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
