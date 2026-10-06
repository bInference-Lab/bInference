import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@binference/core";
import {
  type InboxAdmission,
  inboxAdmissionSchema,
  type InboxDraft,
  inboxDraftSchema,
  type InboxEntry,
  inboxEntrySchema,
} from "@binference/engine";
import type { Selectable } from "kysely";
import { z } from "zod";
import type { EngineTables, InboxTable } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, jsonText, readJson } from "../rows/column-values.js";
import { changedRows, rowCountSchema, timeInputSchema } from "../tasks/count-schema.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask, type TaskRunner } from "../tasks/store-task.js";

function toInboxEntry(row: Selectable<InboxTable>): InboxEntry {
  return inboxEntrySchema.parse({
    id: row.id,
    source: row.source,
    sourceKey: row.source_key,
    payload: readJson(row.payload),
    receivedAtMs: row.received_at,
    ...field("handledAtMs", row.handled_at),
  });
}

function findEntry(database: DatabaseSync, sourceKey: string): InboxEntry | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(kysely.selectFrom("inbox").selectAll().where("source_key", "=", sourceKey));
  return row === undefined ? undefined : toInboxEntry(row);
}

/** Stores an inbound event once; its source key seen before returns the first entry. */
export const admitTask: StoreTask<InboxDraft, InboxAdmission> = defineTask({
  name: "inbox.admit",
  access: "write",
  input: inboxDraftSchema,
  output: inboxAdmissionSchema,
  run(database, draft) {
    const stored = findEntry(database, draft.sourceKey);
    if (stored !== undefined) {
      return { kind: "repeat", entry: stored };
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const inserted = execute(
      kysely.insertInto("inbox").values({
        source: draft.source,
        source_key: draft.sourceKey,
        payload: jsonText(draft.payload),
        received_at: draft.receivedAtMs,
        handled_at: null,
      }),
    );
    return { kind: "new", entry: { ...draft, id: Number(inserted.insertId) } };
  },
});

const markSchema = z.strictObject({ id: z.int().positive(), atMs: timeInputSchema });

/** Marks an entry handled; the first mark wins. */
export const markHandledTask: StoreTask<
  { readonly id: number; readonly atMs: number },
  Result<InboxEntry, "not_found" | "handled">
> = defineTask({
  name: "inbox.mark_handled",
  access: "write",
  input: markSchema,
  output: resultSchema(inboxEntrySchema, ["not_found", "handled"]),
  run(database, mark) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(kysely.selectFrom("inbox").selectAll().where("id", "=", mark.id));
    if (row === undefined) {
      return err("not_found");
    }
    if (row.handled_at !== null) {
      return err("handled");
    }
    execute(kysely.updateTable("inbox").set({ handled_at: mark.atMs }).where("id", "=", mark.id));
    return ok(toInboxEntry({ ...row, handled_at: mark.atMs }));
  },
});

/** Lists the entries not handled yet, oldest first. */
export const unhandledTask: StoreTask<number, readonly InboxEntry[]> = defineTask({
  name: "inbox.unhandled",
  access: "read",
  input: z.int().min(1).max(1_000),
  output: z.array(inboxEntrySchema),
  run(database, limit) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const pending = kysely.selectFrom("inbox").selectAll().where("handled_at", "is", null);
    return execute(pending.orderBy("id").limit(limit)).rows.map(toInboxEntry);
  },
});

/** Deletes the entries handled before a time. */
export const pruneInboxTask: StoreTask<number, number> = defineTask({
  name: "inbox.prune",
  access: "write",
  input: timeInputSchema,
  output: rowCountSchema,
  run(database, beforeMs) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    return changedRows(execute(kysely.deleteFrom("inbox").where("handled_at", "<", beforeMs)));
  },
});

/** Every task of the SQLite inbox. */
export const inboxTasks: readonly TaskRunner[] = [
  admitTask,
  markHandledTask,
  unhandledTask,
  pruneInboxTask,
];
