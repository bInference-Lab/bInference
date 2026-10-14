import { intentRecordSchema, type IntentRecord } from "@binference/engine";
import {
  type FillsInFlightQuery,
  fillsInFlightQuerySchema,
  inFlightStates,
  isOrderAuthorized,
} from "@binference/engine/outflows";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { toIntentRecord } from "./intent-rows.js";

/**
 * Reads every live order fill of an agent that holds its line (decision 0211), with no page
 * limit: the engine's live intents under an order that no `filled` row counts yet, in a state the
 * executor holds, or ended `stuck_dropped` since the query's time with no late landing.
 */
export const fillsInFlightTask: StoreTask<FillsInFlightQuery, readonly IntentRecord[]> = defineTask(
  {
    name: "intents.fills_in_flight",
    access: "read",
    input: fillsInFlightQuerySchema,
    output: z.array(intentRecordSchema),
    run(database, query) {
      const { kysely, execute } = createSyncKysely<EngineTables>(database);
      const select = kysely
        .selectFrom("intents")
        .selectAll()
        .where("agent_id", "=", query.agentId)
        .where("paper", "=", 0)
        .where("proposer", "=", "engine")
        .where((row) =>
          row.or([
            row("state", "in", [...inFlightStates]),
            row.and([
              row("state", "=", "failed_onchain"),
              row("reason", "=", "stuck_dropped"),
              row("changed_at", ">=", query.droppedSinceMs),
              row.not(
                row.exists(
                  row
                    .selectFrom("late_landings")
                    .select("intent_id")
                    .whereRef("late_landings.intent_id", "=", "intents.id"),
                ),
              ),
            ]),
          ]),
        )
        .where((row) =>
          row.not(
            row.exists(
              row
                .selectFrom("order_fills")
                .select("id")
                .whereRef("order_fills.intent_id", "=", "intents.id")
                .where("order_fills.outcome", "=", "filled"),
            ),
          ),
        )
        .orderBy("changed_at")
        .orderBy("id");
      return execute(select)
        .rows.map(toIntentRecord)
        .filter(({ authorizedBy }) => isOrderAuthorized(authorizedBy));
    },
  },
);
