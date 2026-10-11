import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@binference/core";
import {
  type BackupRecord,
  backupIdSchema,
  backupKindSchema,
  backupRecordSchema,
  type BackupVerified,
  backupVerifiedSchema,
} from "@binference/engine/backups";
import type { Selectable } from "kysely";
import { z } from "zod";
import type { BackupTables } from "../databases/backup-tables.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask, type TaskRunner } from "../tasks/store-task.js";

/** Writes a backup's row in the caller's transaction; an id in use breaks the primary key. */
export function insertBackup(database: DatabaseSync, backup: BackupRecord): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely.insertInto("backups").values({
      id: backup.id,
      path: backup.path,
      bytes: backup.bytes,
      kind: backup.kind,
      created_at: backup.createdAtMs,
      verified_at: backup.verifiedAtMs ?? null,
    }),
  );
}

/** Records a backup file once it is written; an id in use breaks the primary key. */
export const recordBackupTask: StoreTask<BackupRecord, null> = defineTask({
  name: "backups.record",
  access: "write",
  input: backupRecordSchema,
  output: z.null(),
  run(database, backup) {
    insertBackup(database, backup);
    return null;
  },
});

/** Marks a backup verified; one the table does not hold is `not_found` and changes nothing. */
export const markVerifiedTask: StoreTask<BackupVerified, Result<void, "not_found">> = defineTask({
  name: "backups.mark_verified",
  access: "write",
  input: backupVerifiedSchema,
  output: resultSchema(z.undefined(), ["not_found"]),
  run(database, verified) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(kysely.selectFrom("backups").select("id").where("id", "=", verified.id));
    if (row === undefined) {
      return err("not_found");
    }
    execute(
      kysely
        .updateTable("backups")
        .set({ verified_at: verified.atMs })
        .where("id", "=", verified.id),
    );
    return ok(undefined);
  },
});

function recordOf(row: Selectable<BackupTables["backups"]>): BackupRecord {
  const record = {
    id: backupIdSchema.parse(row.id),
    path: row.path,
    bytes: row.bytes,
    kind: backupKindSchema.parse(row.kind),
    createdAtMs: row.created_at,
  };
  return row.verified_at === null ? record : { ...record, verifiedAtMs: row.verified_at };
}

/** Every backup, oldest first, then by id, in the caller's transaction. */
export function listBackups(database: DatabaseSync): readonly BackupRecord[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const { rows } = execute(
    kysely.selectFrom("backups").selectAll().orderBy("created_at").orderBy("id"),
  );
  return rows.map(recordOf);
}

/** Every backup, oldest first, then by id. */
export const listBackupsTask: StoreTask<null, readonly BackupRecord[]> = defineTask({
  name: "backups.list",
  access: "read",
  input: z.null(),
  output: z.array(backupRecordSchema).readonly(),
  run: (database) => listBackups(database),
});

/** Forgets the backups with the given ids; other ids change nothing. */
export const forgetBackupsTask: StoreTask<readonly string[], null> = defineTask({
  name: "backups.forget",
  access: "write",
  input: z.array(backupIdSchema).readonly(),
  output: z.null(),
  run(database, ids) {
    if (ids.length === 0) {
      return null;
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(kysely.deleteFrom("backups").where("id", "in", ids));
    return null;
  },
});

/** Every task of the SQLite backup store. */
export const backupTasks: readonly TaskRunner[] = [
  recordBackupTask,
  markVerifiedTask,
  listBackupsTask,
  forgetBackupsTask,
];
