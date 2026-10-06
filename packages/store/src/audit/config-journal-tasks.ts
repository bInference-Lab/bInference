import {
  type ConfigChange,
  configChangeSchema,
  type ConfigJournalEntry,
  configJournalEntrySchema,
  type RowPage,
  rowPageSchema,
} from "@binference/engine";
import type { Selectable } from "kysely";
import { z } from "zod";
import type { ConfigJournalTable, EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, jsonField, optionalJsonText, orNull } from "../rows/column-values.js";
import { defineTask, type StoreTask, type TaskRunner } from "../tasks/store-task.js";

function toJournalEntry(row: Selectable<ConfigJournalTable>): ConfigJournalEntry {
  return configJournalEntrySchema.parse({
    id: row.id,
    atMs: row.at,
    by: row.by,
    surface: row.surface,
    path: row.path,
    ...jsonField("before", row.before),
    ...jsonField("after", row.after),
    ...field("reason", row.reason),
  });
}

/** Records one config change. */
export const recordChangeTask: StoreTask<ConfigChange, ConfigJournalEntry> = defineTask({
  name: "config_journal.record",
  access: "write",
  input: configChangeSchema,
  output: configJournalEntrySchema,
  run(database, change) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const row = {
      at: change.atMs,
      by: change.by,
      surface: change.surface,
      path: change.path,
      before: optionalJsonText(change.before),
      after: optionalJsonText(change.after),
      reason: orNull(change.reason),
    };
    const inserted = execute(kysely.insertInto("config_journal").values(row));
    return toJournalEntry({ ...row, id: Number(inserted.insertId) });
  },
});

/** Lists the entries after a number, in order. */
export const listChangesTask: StoreTask<RowPage, readonly ConfigJournalEntry[]> = defineTask({
  name: "config_journal.list",
  access: "read",
  input: rowPageSchema,
  output: z.array(configJournalEntrySchema),
  run(database, page) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const after = kysely.selectFrom("config_journal").selectAll().where("id", ">", page.after);
    return execute(after.orderBy("id").limit(page.limit)).rows.map(toJournalEntry);
  },
});

/** Every task of the SQLite config journal. */
export const configJournalTasks: readonly TaskRunner[] = [recordChangeTask, listChangesTask];
