import {
  type FillCountQuery,
  fillCountQuerySchema,
  type FillCounts,
  fillCountsSchema,
} from "@binference/engine/orders";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/**
 * How many fill rows of an agent's orders, of any state or mode, filled and skipped from `fromMs`
 * up to, not including, `toMs`: the skips by reason, the most frequent first, then by reason code.
 */
export const fillCountsTask: StoreTask<FillCountQuery, FillCounts> = defineTask({
  name: "orders.fillCounts",
  access: "read",
  input: fillCountQuerySchema,
  output: fillCountsSchema,
  run(database, query) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const grouped = kysely
      .selectFrom("order_fills as fill")
      .innerJoin("orders as order", "order.id", "fill.order_id")
      .select((select) => [
        "fill.outcome as outcome",
        "fill.reason as reason",
        select.fn.countAll<number>().as("count"),
      ])
      .where("order.agent_id", "=", query.agentId)
      .where("fill.at", ">=", query.fromMs)
      .where("fill.at", "<", query.toMs)
      .groupBy(["fill.outcome", "fill.reason"])
      .orderBy("count", "desc")
      .orderBy("fill.reason");
    const rows = execute(grouped).rows;
    return fillCountsSchema.parse({
      filled: rows.find((row) => row.outcome === "filled")?.count ?? 0,
      skipped: rows.flatMap(({ outcome, reason, count }) =>
        outcome === "skipped" && reason !== null ? [{ reason, count }] : [],
      ),
    });
  },
});
