import type { DatabaseSync } from "node:sqlite";
import {
  type IdempotencyEntry,
  idempotencyEntrySchema,
  type IdempotencyLookup,
  idempotencyLookupSchema,
  type IdempotencyRecall,
  idempotencyRecallSchema,
} from "@binference/engine";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { jsonText, readJson } from "../rows/column-values.js";
import { changedRows, rowCountSchema, timeInputSchema } from "../tasks/count-schema.js";
import { defineTask, type StoreTask, type TaskRunner } from "../tasks/store-task.js";

function recall(database: DatabaseSync, lookup: IdempotencyLookup): IdempotencyRecall {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(
    kysely
      .selectFrom("idempotency")
      .select(["args_hash", "result"])
      .where("credential", "=", lookup.credential)
      .where("op", "=", lookup.op)
      .where("key", "=", lookup.key),
  );
  if (row === undefined) {
    return { kind: "new" };
  }
  return row.args_hash === lookup.argsHash
    ? { kind: "repeat", result: readJson(row.result) }
    : { kind: "reused" };
}

/** Reads what the store holds under a key. */
export const recallTask: StoreTask<IdempotencyLookup, IdempotencyRecall> = defineTask({
  name: "idempotency.recall",
  access: "read",
  input: idempotencyLookupSchema,
  output: idempotencyRecallSchema,
  run: (database, lookup) => recall(database, lookup),
});

/** Stores a result under a free key; a held key keeps its first result. */
export const rememberTask: StoreTask<IdempotencyEntry, IdempotencyRecall> = defineTask({
  name: "idempotency.remember",
  access: "write",
  input: idempotencyEntrySchema,
  output: idempotencyRecallSchema,
  run(database, entry) {
    const before = recall(database, entry);
    if (before.kind === "new") {
      const { kysely, execute } = createSyncKysely<EngineTables>(database);
      execute(
        kysely.insertInto("idempotency").values({
          credential: entry.credential,
          op: entry.op,
          key: entry.key,
          args_hash: entry.argsHash,
          result: jsonText(entry.result),
          at: entry.atMs,
        }),
      );
    }
    return before;
  },
});

/** Deletes the results stored before a time. */
export const pruneIdempotencyTask: StoreTask<number, number> = defineTask({
  name: "idempotency.prune",
  access: "write",
  input: timeInputSchema,
  output: rowCountSchema,
  run(database, beforeMs) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    return changedRows(execute(kysely.deleteFrom("idempotency").where("at", "<", beforeMs)));
  },
});

/** Every task of the SQLite idempotency store. */
export const idempotencyTasks: readonly TaskRunner[] = [
  recallTask,
  rememberTask,
  pruneIdempotencyTask,
];
