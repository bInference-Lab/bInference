import {
  type ConfirmedIntent,
  confirmedIntentSchema,
  type ConfirmedQuery,
  confirmedQuerySchema,
} from "@binference/engine/outflows";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field } from "../rows/column-values.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/**
 * Lists one agent's intents of one mode with a move to `confirmed` at or after the query's time,
 * the first confirmed first.
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
          .select([
            "intents.id as id",
            "intents.state as state",
            "intents.value_usd_micros as value",
            "intent_events.at as at",
          ])
          .where("intent_events.to_state", "=", "confirmed")
          .where("intent_events.at", ">=", query.fromMs)
          .where("intents.agent_id", "=", query.agentId)
          .where("intents.paper", "=", query.isPaper ? 1 : 0)
          .orderBy("intent_events.at")
          .orderBy("intents.id"),
      ).rows;
      return rows.map((row) =>
        confirmedIntentSchema.parse({
          intentId: row.id,
          state: row.state,
          confirmedAtMs: row.at,
          ...field("valueUsdMicros", row.value),
        }),
      );
    },
  },
);
