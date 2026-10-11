import type { BackupStore } from "@binference/engine/backups";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import {
  forgetBackupsTask,
  listBackupsTask,
  markVerifiedTask,
  recordBackupTask,
} from "./backup-tasks.js";

/** The {@link BackupStore} on `engine.sqlite`'s `backups` table: each call runs one store task. */
export function createSqliteBackupStore(host: StoreHost): BackupStore {
  const record = bindTask(host, recordBackupTask);
  const list = bindTask(host, listBackupsTask);
  const forget = bindTask(host, forgetBackupsTask);
  return {
    record: async (backup, options) => {
      await record(backup, options);
    },
    markVerified: bindTask(host, markVerifiedTask),
    list: async (options) => list(null, options),
    forget: async (ids, options) => {
      await forget(ids, options);
    },
  };
}
