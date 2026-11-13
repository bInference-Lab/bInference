import { err, ok, type Result } from "@binference/core";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/**
 * Marks the breaker's version told (decision 0440): `stale`, changing nothing, unless it is the
 * version the install applied and was not told yet.
 */
export const tellBreakerTask: StoreTask<number, Result<void, "stale">> = defineTask({
  name: "install.tell_breaker",
  access: "write",
  input: z.int().positive(),
  output: resultSchema(z.undefined(), ["stale"]),
  run(database, version) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const told = execute(
      kysely
        .updateTable("safety")
        .set({ breaker_told: version })
        .where("id", "=", 1)
        .where("breaker_version", "=", version)
        .where("breaker_told", "<", version),
    );
    return told.numAffectedRows === 1n ? ok(undefined) : err("stale");
  },
});
