import { BinferenceError, err, type Id, idSchema, ok, type Result } from "@binference/core";
import {
  type FillAnnouncement,
  fillAnnouncementSchema,
  type OrderDraft,
  orderDraftSchema,
  type OrderFillQuery,
  orderFillQuerySchema,
  type OrderFillRecord,
  orderFillRecordSchema,
  type OrderFillWrite,
  orderFillWriteSchema,
  type OrderMove,
  type OrderMoveRefusal,
  orderMoveSchema,
  type OrderQuery,
  orderQuerySchema,
  type OrderRecord,
  orderRecordSchema,
  type UnannouncedFillQuery,
  unannouncedFillQuerySchema,
} from "@binference/engine/orders";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask, type TaskRunner } from "../tasks/store-task.js";
import { copyBuysTask } from "./copy-buy-rows.js";
import {
  checkOrderFill,
  checkOwnFill,
  insertOrderFill,
  countedFillOf,
  isCounted,
  listOrderFills,
  listUnannounced,
  markAnnounced,
} from "./order-fill-writes.js";
import { toOrderRecord } from "./order-rows.js";
import { checkOrderMoves, createOrder, readOrder, writeOrderMoves } from "./order-writes.js";

/** Stores a new order awaiting its card. */
export const createOrderTask: StoreTask<
  OrderDraft,
  Result<OrderRecord, "exists" | "frozen" | "track_limit">
> = defineTask({
  name: "orders.create",
  access: "write",
  input: orderDraftSchema,
  output: resultSchema(orderRecordSchema, ["exists", "frozen", "track_limit"]),
  run: (database, draft) => createOrder(database, draft),
});

/** Writes order moves all or nothing. */
export const moveOrdersTask: StoreTask<
  readonly OrderMove[],
  Result<readonly OrderRecord[], OrderMoveRefusal>
> = defineTask({
  name: "orders.move",
  access: "write",
  input: z.array(orderMoveSchema),
  output: resultSchema(z.array(orderRecordSchema), [
    "not_found",
    "stale",
    "not_confirmed",
    "frozen",
  ]),
  run(database, moves) {
    const checked = checkOrderMoves(database, moves);
    return checked.ok ? { ok: true, value: writeOrderMoves(database, checked.value) } : checked;
  },
});

/** Reads one order. */
export const getOrderTask: StoreTask<Id<"ord">, OrderRecord | undefined> = defineTask({
  name: "orders.get",
  access: "read",
  input: idSchema("ord"),
  output: orderRecordSchema.optional(),
  run: (database, id) => readOrder(database, id),
});

/** Reads the order whose card an `autoOrder` intent carries. */
export const orderByIntentTask: StoreTask<Id<"int">, OrderRecord | undefined> = defineTask({
  name: "orders.byIntent",
  access: "read",
  input: idSchema("int"),
  output: orderRecordSchema.optional(),
  run(database, intent) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(kysely.selectFrom("orders").selectAll().where("intent_id", "=", intent));
    return row === undefined ? undefined : toOrderRecord(row);
  },
});

/** Lists orders in some states, the oldest first, then by id. */
export const listOrdersTask: StoreTask<OrderQuery, readonly OrderRecord[]> = defineTask({
  name: "orders.list",
  access: "read",
  input: orderQuerySchema,
  output: z.array(orderRecordSchema),
  run(database, query) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const { agentId, walletId, isPaper, expiresByMs, after } = query;
    let select = kysely
      .selectFrom("orders")
      .selectAll()
      .where("state", "in", [...query.states]);
    if (agentId !== undefined) {
      select = select.where("agent_id", "=", agentId);
    }
    if (walletId !== undefined) {
      select = select.where("wallet_id", "=", walletId);
    }
    if (isPaper !== undefined) {
      select = select.where("paper", "=", isPaper ? 1 : 0);
    }
    if (expiresByMs !== undefined) {
      select = select.where("expires_at", "<=", expiresByMs);
    }
    if (after !== undefined) {
      select = select.where((row) =>
        row.or([
          row("created_at", ">", after.createdAtMs),
          row.and([row("created_at", "=", after.createdAtMs), row("id", ">", after.id)]),
        ]),
      );
    }
    const ordered = select.orderBy("created_at").orderBy("id").limit(query.limit);
    return execute(ordered).rows.map(toOrderRecord);
  },
});

/** Stores one fill row of an order, such as a skip. */
export const recordOrderFillTask: StoreTask<OrderFillRecord, OrderFillRecord> = defineTask({
  name: "orders.recordFill",
  access: "write",
  input: orderFillRecordSchema,
  output: orderFillRecordSchema,
  run(database, fill) {
    checkOrderFill(database, fill);
    return insertOrderFill(database, fill);
  },
});

/**
 * Counts a landed live fill on its order apart from its intent's move: its moves and its `filled`
 * row in one transaction, once per intent (decision 0211).
 */
export const recordLandedFillTask: StoreTask<
  OrderFillWrite,
  Result<readonly OrderRecord[], "counted" | "stale">
> = defineTask({
  name: "orders.recordLandedFill",
  access: "write",
  input: orderFillWriteSchema,
  output: resultSchema(z.array(orderRecordSchema), ["counted", "stale"]),
  run(database, write) {
    const { fill } = write;
    if (fill.outcome !== "filled" || fill.intentId === undefined) {
      throw new BinferenceError({
        code: "store.constraint",
        message: "A landed fill is a filled row that names its intent.",
        details: { fill: fill.id },
      });
    }
    if (isCounted(database, fill.intentId)) {
      return err("counted");
    }
    checkOrderFill(database, fill);
    checkOwnFill(database, write);
    if (!checkOrderMoves(database, write.moves).ok) {
      return err("stale");
    }
    const orders = writeOrderMoves(database, write.moves);
    insertOrderFill(database, fill);
    return ok(orders);
  },
});

/** Reads the `filled` row that counts an intent's fill. */
export const countedFillTask: StoreTask<Id<"int">, OrderFillRecord | undefined> = defineTask({
  name: "orders.countedFill",
  access: "read",
  input: idSchema("int"),
  output: orderFillRecordSchema.optional(),
  run: (database, intent) => countedFillOf(database, intent),
});

/** Lists one order's fill rows, the newest first. */
export const listOrderFillsTask: StoreTask<OrderFillQuery, readonly OrderFillRecord[]> = defineTask(
  {
    name: "orders.fills",
    access: "read",
    input: orderFillQuerySchema,
    output: z.array(orderFillRecordSchema),
    run: (database, query) => listOrderFills(database, query),
  },
);

/** Lists the fill rows whose notices were never announced, the oldest first. */
export const unannouncedFillsTask: StoreTask<UnannouncedFillQuery, readonly OrderFillRecord[]> =
  defineTask({
    name: "orders.unannounced",
    access: "read",
    input: unannouncedFillQuerySchema,
    output: z.array(orderFillRecordSchema),
    run: (database, query) => listUnannounced(database, query),
  });

/** Marks fill rows' notices announced. */
export const markAnnouncedTask: StoreTask<FillAnnouncement, void> = defineTask({
  name: "orders.markAnnounced",
  access: "write",
  input: fillAnnouncementSchema,
  output: z.undefined(),
  run(database, announcement) {
    markAnnounced(database, announcement);
  },
});

/** Every task of the SQLite order store. */
export const orderTasks: readonly TaskRunner[] = [
  createOrderTask,
  moveOrdersTask,
  getOrderTask,
  orderByIntentTask,
  listOrdersTask,
  recordOrderFillTask,
  recordLandedFillTask,
  countedFillTask,
  listOrderFillsTask,
  unannouncedFillsTask,
  markAnnouncedTask,
  copyBuysTask,
];
