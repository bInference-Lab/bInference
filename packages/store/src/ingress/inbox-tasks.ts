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
import type { StoreConnection } from "../dialect/store-connection.js";
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

function findEntry(database: StoreConnection, sourceKey: string): InboxEntry | undefined {
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

interface InboxPage {
  readonly keyPrefix: string;
  readonly limit: number;
}

// A prefix is printable ASCII, so the text after its last character bounds its range.
const pageSchema: z.ZodType<InboxPage> = z.strictObject({
  keyPrefix: z.string().regex(/^[!-~]{1,64}$/),
  limit: z.int().min(1).max(1_000),
});

// The first text after every text that starts with `prefix`, so the unique index on `source_key`
// finds a source's entries as a range.
function afterPrefix(prefix: string): string {
  return `${prefix.slice(0, -1)}${String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)}`;
}

/** Lists the entries of one source key prefix not handled yet, oldest first. */
export const unhandledTask: StoreTask<InboxPage, readonly InboxEntry[]> = defineTask({
  name: "inbox.unhandled",
  access: "read",
  input: pageSchema,
  output: z.array(inboxEntrySchema),
  run(database, page) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const pending = kysely
      .selectFrom("inbox")
      .selectAll()
      .where("handled_at", "is", null)
      .where("source_key", ">=", page.keyPrefix)
      .where("source_key", "<", afterPrefix(page.keyPrefix));
    return execute(pending.orderBy("id").limit(page.limit)).rows.map(toInboxEntry);
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
