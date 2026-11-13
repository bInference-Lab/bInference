import { BinferenceError, stableJson } from "@binference/core";
import {
  type IdempotencyEntry,
  idempotencyEntrySchema,
  type IdempotencyLookup,
  idempotencyLookupSchema,
  type IdempotencyMark,
  idempotencyMarkSchema,
  type IdempotencyPrune,
  idempotencyPruneSchema,
  type IdempotencyStart,
  idempotencyStartSchema,
} from "@binference/engine";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { jsonText, readJson } from "../rows/column-values.js";
import { changedRows, rowCountSchema } from "../tasks/count-schema.js";
import { defineTask, type StoreTask, type TaskRunner } from "../tasks/store-task.js";

interface KeyRow {
  readonly args_hash: string;
  readonly result: string | null;
}

function rowOf(database: StoreConnection, lookup: IdempotencyLookup): KeyRow | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  return takeFirst(
    kysely
      .selectFrom("idempotency")
      .select(["args_hash", "result"])
      .where("credential", "=", lookup.credential)
      .where("op", "=", lookup.op)
      .where("key", "=", lookup.key),
  );
}

// What a held key answers a write with the lookup's args hash (decision 0437).
function startOf(row: KeyRow, lookup: IdempotencyLookup): IdempotencyStart {
  if (row.args_hash !== lookup.argsHash) {
    return { kind: "reused" };
  }
  return row.result === null
    ? { kind: "unfinished" }
    : { kind: "repeat", result: readJson(row.result) };
}

/** Marks a free key started, with no result; a held key answers what it holds (decision 0437). */
export const startTask: StoreTask<IdempotencyMark, IdempotencyStart> = defineTask({
  name: "idempotency.start",
  access: "write",
  input: idempotencyMarkSchema,
  output: idempotencyStartSchema,
  run(database, mark) {
    const row = rowOf(database, mark);
    if (row !== undefined) {
      return startOf(row, mark);
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely.insertInto("idempotency").values({
        credential: mark.credential,
        op: mark.op,
        key: mark.key,
        args_hash: mark.argsHash,
        result: null,
        at: mark.atMs,
      }),
    );
    return { kind: "started" };
  },
});

function resultRowOf(entry: IdempotencyEntry): EngineTables["idempotency"] {
  return {
    credential: entry.credential,
    op: entry.op,
    key: entry.key,
    args_hash: entry.argsHash,
    result: jsonText(entry.result),
    at: entry.atMs,
  };
}

function finishRefused(entry: IdempotencyEntry, what: string): BinferenceError {
  return new BinferenceError({
    code: "store.constraint",
    message: `The idempotency store refused the result of ${entry.op}: ${what}.`,
    details: { what: entry.op },
  });
}

/**
 * Fills a started key's result, or writes it again when a prune took the mark; the same result
 * again is done, anything else refused.
 */
export const finishTask: StoreTask<IdempotencyEntry, undefined> = defineTask({
  name: "idempotency.finish",
  access: "write",
  input: idempotencyEntrySchema,
  output: z.undefined(),
  run(database, entry) {
    const row = rowOf(database, entry);
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    if (row === undefined) {
      execute(kysely.insertInto("idempotency").values(resultRowOf(entry)));
      return undefined;
    }
    if (row.args_hash !== entry.argsHash) {
      throw finishRefused(entry, "its key was started with other args");
    }
    if (row.result !== null) {
      if (stableJson(readJson(row.result)) !== stableJson(entry.result)) {
        throw finishRefused(entry, "its key holds another result");
      }
      return undefined;
    }
    execute(
      kysely
        .updateTable("idempotency")
        .set({ result: jsonText(entry.result), at: entry.atMs })
        .where("credential", "=", entry.credential)
        .where("op", "=", entry.op)
        .where("key", "=", entry.key),
    );
    return undefined;
  },
});

/** Removes a started key with no result and the same args hash, so its key may run again. */
export const forgetTask: StoreTask<IdempotencyLookup, undefined> = defineTask({
  name: "idempotency.forget",
  access: "write",
  input: idempotencyLookupSchema,
  output: z.undefined(),
  run(database, lookup) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely
        .deleteFrom("idempotency")
        .where("credential", "=", lookup.credential)
        .where("op", "=", lookup.op)
        .where("key", "=", lookup.key)
        .where("args_hash", "=", lookup.argsHash)
        .where("result", "is", null),
    );
    return undefined;
  },
});

/** Deletes the keys started or stored before a time, but the marks of the writes still running. */
export const pruneIdempotencyTask: StoreTask<IdempotencyPrune, number> = defineTask({
  name: "idempotency.prune",
  access: "write",
  input: idempotencyPruneSchema,
  output: rowCountSchema,
  run(database, cut) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const pruned = kysely
      .deleteFrom("idempotency")
      .where((eb) =>
        eb.and([
          eb("at", "<", cut.beforeMs),
          ...cut.running.map((lookup) =>
            eb.not(
              eb.and([
                eb("credential", "=", lookup.credential),
                eb("op", "=", lookup.op),
                eb("key", "=", lookup.key),
              ]),
            ),
          ),
        ]),
      );
    return changedRows(execute(pruned));
  },
});

/** Every task of the SQLite idempotency store. */
export const idempotencyTasks: readonly TaskRunner[] = [
  startTask,
  finishTask,
  forgetTask,
  pruneIdempotencyTask,
];
