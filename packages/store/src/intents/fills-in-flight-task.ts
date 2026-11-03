import { intentRecordSchema, type IntentRecord } from "@binference/engine";
import {
  type FillsInFlightQuery,
  fillsInFlightQuerySchema,
  inFlightStates,
  isFillAuthorized,
} from "@binference/engine/outflows";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { toIntentRecord } from "./intent-rows.js";

// The intents an order's `filled` row or a rule's `filled` alert counts: their fills hold no line.
function countedFills(kysely: Kysely<EngineTables>) {
  return kysely
    .selectFrom("order_fills")
    .select("intent_id")
    .where("outcome", "=", "filled")
    .where("intent_id", "is not", null)
    .union(
      kysely
        .selectFrom("webhook_events")
        .select("intent_id")
        .where("fill_outcome", "=", "filled")
        .where("intent_id", "is not", null),
    );
}

/**
 * Reads every live fill of an agent's auto orders and webhook rules that holds its line (decisions
 * 0211 and 0342), with no page limit: the engine's live intents under an order or a rule that no
 * `filled` row or alert counts yet, in a state the executor holds, or ended `stuck_dropped` since
 * the query's time with no late landing.
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
        .where("id", "not in", countedFills(kysely))
        .orderBy("changed_at")
        .orderBy("id");
      return execute(select)
        .rows.map(toIntentRecord)
        .filter(({ authorizedBy }) => isFillAuthorized(authorizedBy));
    },
  },
);
