import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

// The table holds one row, `id = 1`, once the engine marked a run.
const aliveRow = 1;

const atMsSchema = z.int().nonnegative();

/** The last mark of a run, or null before the first. */
export const lastAliveTask: StoreTask<null, number | null> = defineTask({
  name: "downtime.last_alive",
  access: "read",
  input: z.null(),
  output: atMsSchema.nullable(),
  run(database) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely.selectFrom("engine_alive").select("alive_at").where("id", "=", aliveRow),
    );
    return row?.alive_at ?? null;
  },
});

/** Keeps the mark in place of the one before. */
export const markAliveTask: StoreTask<number, null> = defineTask({
  name: "downtime.mark_alive",
  access: "write",
  input: atMsSchema,
  output: z.null(),
  run(database, atMs) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely
        .insertInto("engine_alive")
        .values({ id: aliveRow, alive_at: atMs })
        .onConflict((conflict) => conflict.column("id").doUpdateSet({ alive_at: atMs })),
    );
    return null;
  },
});
