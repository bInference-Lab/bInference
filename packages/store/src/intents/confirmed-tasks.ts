import { err, ok, type Result } from "@binference/core";
import {
  type ConfirmedIntent,
  confirmedIntentSchema,
  type ConfirmedQuery,
  confirmedQuerySchema,
  type LateLanding,
  lateLandingSchema,
} from "@binference/engine/outflows";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/**
 * Lists one agent's intents of one mode with a move to `confirmed` at or after the query's time,
 * each once at its first such move, the first confirmed first: a confirmation again on a new card
 * version (decision 0143) is still one trade.
 */
export const confirmedSinceTask: StoreTask<ConfirmedQuery, readonly ConfirmedIntent[]> = defineTask(
  {
    name: "intents.confirmed_since",
    access: "read",
    input: confirmedQuerySchema,
    output: z.array(confirmedIntentSchema),
    run(database, query) {
      const { kysely, execute } = createSyncKysely<EngineTables>(database);
      const rows = execute(
        kysely
          .selectFrom("intent_events")
          .innerJoin("intents", "intents.id", "intent_events.intent_id")
          .leftJoin("late_landings", "late_landings.intent_id", "intents.id")
          .select(({ fn }) => [
            "intents.id as id",
            "intents.state as state",
            "intents.value_usd_micros as value",
            "late_landings.at as landedAt",
            fn.min("intent_events.at").as("at"),
          ])
          .where("intent_events.to_state", "=", "confirmed")
          .where("intent_events.at", ">=", query.fromMs)
          .where("intents.agent_id", "=", query.agentId)
          .where("intents.paper", "=", query.isPaper ? 1 : 0)
          .groupBy(["intents.id", "intents.state", "intents.value_usd_micros", "late_landings.at"])
          .orderBy("at")
          .orderBy("intents.id"),
      ).rows;
      return rows.map((row) =>
        confirmedIntentSchema.parse({
          intentId: row.id,
          state: row.state,
          confirmedAtMs: row.at,
          ...field("valueUsdMicros", row.value),
          ...field("landedLateAtMs", row.landedAt),
        }),
      );
    },
  },
);

/**
 * Links a late landing to its intent (decision 0147), leaving the intent as it is: an intent with
 * one already is `exists`, an unknown intent `not_found`.
 */
export const recordLandedLateTask: StoreTask<
  LateLanding,
  Result<LateLanding, "exists" | "not_found">
> = defineTask({
  name: "intents.record_landed_late",
  access: "write",
  input: lateLandingSchema,
  output: resultSchema(lateLandingSchema, ["exists", "not_found"]),
  run(database, landing) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const intent = takeFirst(
      kysely.selectFrom("intents").select("id").where("id", "=", landing.intentId),
    );
    if (intent === undefined) {
      return err("not_found");
    }
    const earlier = takeFirst(
      kysely
        .selectFrom("late_landings")
        .select("intent_id")
        .where("intent_id", "=", landing.intentId),
    );
    if (earlier !== undefined) {
      return err("exists");
    }
    execute(
      kysely
        .insertInto("late_landings")
        .values({ intent_id: landing.intentId, tx_id: landing.txId, at: landing.atMs }),
    );
    return ok(landing);
  },
});
