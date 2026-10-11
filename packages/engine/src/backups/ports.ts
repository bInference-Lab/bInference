import type { Id, Result } from "@binference/core";
import type { BackupRecord, BackupVerified } from "./backup-record.js";

/** What every backup store call takes. A call on an aborted signal rejects and changes nothing. */
interface StoreCall {
  readonly signal: AbortSignal;
}

/**
 * Keeps a record of each backup file the install wrote (database spec, `backups`; keys spec,
 * section 7): its path, size and kind, and when it was verified. It holds the backups that
 * retention keeps, so it stays a few dozen rows. Adapters: the SQLite store in
 * `@binference/store`.
 */
export interface BackupStore {
  /** Records a backup once its file is written. An id in use is a `store.constraint` fault. */
  record(backup: BackupRecord, options: StoreCall): Promise<void>;
  /** Marks a backup verified; a backup the store does not hold is `not_found`. */
  markVerified(verified: BackupVerified, options: StoreCall): Promise<Result<void, "not_found">>;
  /** Every backup, oldest first, then by id. */
  list(options: StoreCall): Promise<readonly BackupRecord[]>;
  /** Forgets the backups with these ids, once their files are gone; other ids change nothing. */
  forget(ids: readonly Id<"bkp">[], options: StoreCall): Promise<void>;
}
