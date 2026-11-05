import { BinferenceError } from "@binference/core";
import {
  type CopyBuyQuery,
  type CopyBuyRecord,
  copyBuyQuerySchema,
  copyBuyRecordSchema,
} from "@binference/engine/orders";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

// The write-order number of the row a page starts after; a row the store does not hold throws, so
// a cap never sums a page it cannot place.
function seqAfter(database: StoreConnection, after: CopyBuyQuery["after"]): number {
  if (after === undefined) {
    return 0;
  }
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(kysely.selectFrom("order_fills").select("seq").where("id", "=", after));
  if (row === undefined) {
    throw new BinferenceError({
      code: "store.constraint",
      message: "A page of copy buys starts after a stored row.",
      details: { fill: after },
    });
  }
  return row.seq;
}

/**
 * An agent's copy buys of one leader from a time on, in any order state, in the order they were
 * written (decisions 0260 and 0366): its copy orders' `filled` rows whose intents bought, each at
 * its intent's judged value, else its order's dollars per buy.
 */
export const copyBuysTask: StoreTask<CopyBuyQuery, readonly CopyBuyRecord[]> = defineTask({
  name: "orders.copyBuys",
  access: "read",
  input: copyBuyQuerySchema,
  output: z.array(copyBuyRecordSchema),
  run(database, query) {
    const { kysely, execute, jsonField } = createSyncKysely<EngineTables>(database);
    const after = seqAfter(database, query.after);
    const rows = kysely
      .selectFrom("order_fills as fill")
      .innerJoin("orders as order", "order.id", "fill.order_id")
      .innerJoin("intents as intent", "intent.id", "fill.intent_id")
      .select([
        "fill.id as id",
        "fill.at as at",
        "intent.value_usd_micros as value",
        jsonField("order.request", ["trigger", "perBuyUsdMicros"]).as("perBuy"),
      ])
      .where("order.agent_id", "=", query.agentId)
      .where("order.kind", "=", "copy")
      .where(jsonField("order.request", ["trigger", "leader"]), "=", query.leader)
      .where("fill.outcome", "=", "filled")
      .where("intent.kind", "=", "buy")
      .where("fill.at", ">=", query.fromMs)
      .where("fill.seq", ">", after);
    const ordered = rows.orderBy("fill.seq").limit(query.limit);
    return execute(ordered).rows.map((row) =>
      copyBuyRecordSchema.parse({ id: row.id, atMs: row.at, usdMicros: row.value ?? row.perBuy }),
    );
  },
});
