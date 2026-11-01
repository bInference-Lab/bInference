import { jsonValueSchema } from "@binference/core";
import {
  reachAfter,
  type RescueReachChange,
  rescueReachChangeSchema,
} from "@binference/engine/install";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { jsonText } from "../rows/column-values.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { readRescue, readRescueReach } from "./install-rows.js";

/**
 * Replaces the standings of the rescue addresses for the agents a change names, keeping every
 * other agent's, and forgets each one whose address is neither the rescue address nor the one that
 * waits, all as the `safety` row holds them in this transaction (decision 0321); none left stores
 * NULL.
 */
export const keepRescueReachTask: StoreTask<RescueReachChange, null> = defineTask({
  name: "install.keep_rescue_reach",
  access: "write",
  input: rescueReachChangeSchema,
  output: z.null(),
  run(database, reach) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const held = readRescueReach(database) ?? [];
    const after = reachAfter(held, { reach, rescue: readRescue(database) });
    const kept = after.length === 0 ? null : jsonText(jsonValueSchema.parse(after));
    execute(kysely.updateTable("safety").set({ rescue_reach: kept }).where("id", "=", 1));
    return null;
  },
});
