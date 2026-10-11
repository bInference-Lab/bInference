import type { DatabaseSync } from "node:sqlite";
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

// The outflows a restore carried for one agent and mode (keys spec, section 7.4), as confirmed
// intents; each counts in the place of the database's own count of the same intent.
function carriedSince(database: DatabaseSync, query: ConfirmedQuery): readonly ConfirmedIntent[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const { rows } = execute(
    kysely
      .selectFrom("carried_outflows")
      .selectAll()
      .where("agent_id", "=", query.agentId)
      .where("paper", "=", query.isPaper ? 1 : 0)
      .where("confirmed_at", ">=", query.fromMs),
  );
  return rows.map((row) =>
    confirmedIntentSchema.parse({
      intentId: row.intent_id,
      state: "confirmed",
      confirmedAtMs: row.confirmed_at,
      valueUsdMicros: row.value_usd_micros,
    }),
  );
}

/**
 * One agent's intents of one mode with a move to `confirmed` at or after the query's time, each
 * once at its first such move, the first confirmed first, with the outflows a restore carried in
 * the place of the same intents' own rows; in the caller's transaction.
 */
export function confirmedSince(
  database: DatabaseSync,
  query: ConfirmedQuery,
): readonly ConfirmedIntent[] {
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
  const carried = carriedSince(database, query);
  const ids = new Set<string>(carried.map((outflow) => outflow.intentId));
  const own = rows
    .filter((row) => !ids.has(row.id))
    .map((row) =>
      confirmedIntentSchema.parse({
        intentId: row.id,
        state: row.state,
        confirmedAtMs: row.at,
        ...field("valueUsdMicros", row.value),
        ...field("landedLateAtMs", row.landedAt),
      }),
    );
  return [...own, ...carried].toSorted(
    (left, right) =>
      left.confirmedAtMs - right.confirmedAtMs || left.intentId.localeCompare(right.intentId),
  );
}

/**
 * Lists one agent's intents of one mode with a move to `confirmed` at or after the query's time,
 * each once at its first such move, the first confirmed first: a confirmation again on a new card
 * version (decision 0143) is still one trade. The outflows a restore carried join them, each in
 * the place of the same intent's own row.
 */
export const confirmedSinceTask: StoreTask<ConfirmedQuery, readonly ConfirmedIntent[]> = defineTask(
  {
    name: "intents.confirmed_since",
    access: "read",
    input: confirmedQuerySchema,
    output: z.array(confirmedIntentSchema),
    run: (database, query) => confirmedSince(database, query),
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
