import {
  type CopyBuyQuery,
  type CopyBuyRecord,
  copyBuyQuerySchema,
  copyBuyRecordSchema,
} from "@binference/engine/orders";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/**
 * An agent's copy buys of one leader from a time on, in any order state, oldest first, then by id
 * (decision 0260): its copy orders' `filled` rows whose intents bought, each at its intent's judged
 * value, else its order's dollars per buy.
 */
export const copyBuysTask: StoreTask<CopyBuyQuery, readonly CopyBuyRecord[]> = defineTask({
  name: "orders.copyBuys",
  access: "read",
  input: copyBuyQuerySchema,
  output: z.array(copyBuyRecordSchema),
  run(database, query) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const { after } = query;
    const rows = kysely
      .selectFrom("order_fills as fill")
      .innerJoin("orders as order", "order.id", "fill.order_id")
      .innerJoin("intents as intent", "intent.id", "fill.intent_id")
      .select((select) => [
        "fill.id as id",
        "fill.at as at",
        "intent.value_usd_micros as value",
        select
          .fn<string>("json_extract", ["order.request", select.val("$.trigger.perBuyUsdMicros")])
          .as("perBuy"),
      ])
      .where("order.agent_id", "=", query.agentId)
      .where("order.kind", "=", "copy")
      .where(
        (where) =>
          where.fn<string>("json_extract", ["order.request", where.val("$.trigger.leader")]),
        "=",
        query.leader,
      )
      .where("fill.outcome", "=", "filled")
      .where("intent.kind", "=", "buy")
      .where("fill.at", ">=", query.fromMs);
    const paged =
      after === undefined
        ? rows
        : rows.where((where) =>
            where.or([
              where("fill.at", ">", after.atMs),
              where.and([where("fill.at", "=", after.atMs), where("fill.id", ">", after.id)]),
            ]),
          );
    const ordered = paged.orderBy("fill.at").orderBy("fill.id").limit(query.limit);
    return execute(ordered).rows.map((row) =>
      copyBuyRecordSchema.parse({ id: row.id, atMs: row.at, usdMicros: row.value ?? row.perBuy }),
    );
  },
});
