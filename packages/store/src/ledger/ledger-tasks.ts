import {
  type LedgerDraft,
  ledgerDraftSchema,
  type LedgerEntry,
  ledgerEntrySchema,
  type RowPage,
  rowPageSchema,
} from "@binference/engine";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask, type TaskRunner } from "../tasks/store-task.js";
import { appendLedgerEntry, toLedgerEntry } from "./ledger-rows.js";

/** Appends one entry at the end of the chain. */
export const appendLedgerTask: StoreTask<LedgerDraft, LedgerEntry> = defineTask({
  name: "ledger.append",
  access: "write",
  input: ledgerDraftSchema,
  output: ledgerEntrySchema,
  run: (database, draft) => appendLedgerEntry(database, draft),
});

/** Lists the entries after a seq, in order. */
export const listLedgerTask: StoreTask<RowPage, readonly LedgerEntry[]> = defineTask({
  name: "ledger.list",
  access: "read",
  input: rowPageSchema,
  output: z.array(ledgerEntrySchema),
  run(database, page) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const rows = execute(
      kysely
        .selectFrom("ledger")
        .selectAll()
        .where("seq", ">", page.after)
        .orderBy("seq")
        .limit(page.limit),
    ).rows;
    return rows.map(toLedgerEntry);
  },
});

/** Reads the newest entry. */
export const lastLedgerTask: StoreTask<null, LedgerEntry | undefined> = defineTask({
  name: "ledger.last",
  access: "read",
  input: z.null(),
  output: ledgerEntrySchema.optional(),
  run(database) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(kysely.selectFrom("ledger").selectAll().orderBy("seq", "desc").limit(1));
    return row === undefined ? undefined : toLedgerEntry(row);
  },
});

/** Every task of the SQLite ledger store. */
export const ledgerTasks: readonly TaskRunner[] = [
  appendLedgerTask,
  listLedgerTask,
  lastLedgerTask,
];
