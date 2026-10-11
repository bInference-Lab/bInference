import type { EnginePush } from "./engine-push.js";
import { noticePush } from "./notice-push.js";

/** The message key of the notice that a backup or its check failed (spec 4, section 4). */
export const backupFailedNoticeKey = "notice.backupFailed";

/**
 * Why a backup failed, as the notice names it: `no_owner_key` when the install holds no owner
 * key to seal it to, `snapshot` when a database could not be copied, `write` when the file could
 * not be written, `check` when reading it back found a chunk or a file that does not match, and
 * `copy` when the second copy in `backups.copyTo` could not be written.
 */
export type BackupFailure = "no_owner_key" | "snapshot" | "write" | "check" | "copy";

/**
 * The notice that tells every surface the night's backup or its check failed (keys spec, section
 * 7.3), with the reason in plain words. It names no agent: a backup holds the whole install.
 */
export function backupFailedNotice(reason: BackupFailure): EnginePush {
  return noticePush({ key: backupFailedNoticeKey, values: { reason } });
}
