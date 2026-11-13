import {
  type CreatedIntent,
  createdIntentSchema,
  type CreatedQuery,
  createdQuerySchema,
} from "@binference/engine/quotas";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/**
 * Lists one agent's intents stored at or after the query's time, in any state, with their kind
 * and proposer, the first stored first, then by id: what the proposal quota counts (decision 0431).
 */
export const createdSinceTask: StoreTask<CreatedQuery, readonly CreatedIntent[]> = defineTask({
  name: "intents.created_since",
  access: "read",
  input: createdQuerySchema,
  output: z.array(createdIntentSchema),
  run(database, query) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const stored = kysely
      .selectFrom("intents")
      .select(["id", "kind", "proposer", "created_at"])
      .where("agent_id", "=", query.agentId)
      .where("created_at", ">=", query.fromMs)
      .orderBy("created_at")
      .orderBy("id");
    return execute(stored).rows.map((row) =>
      createdIntentSchema.parse({
        intentId: row.id,
        kind: row.kind,
        proposer: row.proposer,
        createdAtMs: row.created_at,
      }),
    );
  },
});
