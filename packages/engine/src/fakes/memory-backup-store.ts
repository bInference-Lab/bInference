import { err, ok } from "@binference/core";
import type { BackupRecord } from "../backups/backup-record.js";
import type { BackupStore } from "../backups/ports.js";
import { byCreation, constraintFault, memoryCall } from "./memory-call.js";

/** Creates an empty in-memory {@link BackupStore} for tests. */
export function createMemoryBackupStore(): BackupStore {
  const rows = new Map<string, BackupRecord>();
  return {
    record: async (backup, options) =>
      memoryCall(options, () => {
        if (rows.has(backup.id)) {
          throw constraintFault(`a backup with id ${backup.id} is stored already`);
        }
        rows.set(backup.id, structuredClone(backup));
      }),
    markVerified: async (verified, options) =>
      memoryCall(options, () => {
        const row = rows.get(verified.id);
        if (row === undefined) {
          return err("not_found");
        }
        rows.set(verified.id, { ...row, verifiedAtMs: verified.atMs });
        return ok(undefined);
      }),
    list: async (options) =>
      memoryCall(options, () =>
        [...rows.values()].toSorted(byCreation).map((row) => structuredClone(row)),
      ),
    forget: async (ids, options) =>
      memoryCall(options, () => {
        ids.forEach((id) => rows.delete(id));
      }),
  };
}
