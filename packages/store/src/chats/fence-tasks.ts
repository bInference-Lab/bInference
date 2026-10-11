import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { AgentTables } from "../databases/agent-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { fenceSchema } from "./fenced.js";

const fenceKey = "writer_fence";

function currentFence(database: DatabaseSync): number {
  const { kysely, takeFirst } = createSyncKysely<AgentTables>(database);
  const row = takeFirst(kysely.selectFrom("meta").select("value").where("key", "=", fenceKey));
  return row === undefined ? 0 : Number(row.value);
}

/**
 * Whether a write made with `fence` may change the database, read inside the write's own
 * transaction: its fence is the one the latest start raised.
 */
export function holdsFence(database: DatabaseSync, fence: number): boolean {
  return currentFence(database) === fence;
}

/** Raises the writer fence and answers its new value. */
export const raiseFenceTask: StoreTask<null, number> = defineTask({
  name: "chats.raise_fence",
  access: "write",
  input: z.null(),
  output: fenceSchema,
  run(database) {
    const raised = currentFence(database) + 1;
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(
      kysely
        .insertInto("meta")
        .values({ key: fenceKey, value: String(raised) })
        .onConflict((conflict) => conflict.column("key").doUpdateSet({ value: String(raised) })),
    );
    return raised;
  },
});
