import type { BackupRecord } from "@binference/engine/backups";

/** How many backups of each kind retention keeps. */
export interface BackupsKept {
  /** The scheduled ones, daily and weekly alike: `backups.keepDaily`, 7 by default. */
  readonly daily: number;
  /** The weekly ones, taken on Sundays: `backups.keepWeekly`, 4 by default. */
  readonly weekly: number;
  /** Those taken before an update or a migration, together: 3. */
  readonly beforeChanges: number;
}

const newestFirst = (left: BackupRecord, right: BackupRecord): number =>
  right.createdAtMs - left.createdAtMs || (left.id < right.id ? 1 : -1);

function newest(
  backups: readonly BackupRecord[],
  kinds: readonly BackupRecord["kind"][],
  count: number,
): readonly BackupRecord[] {
  return backups
    .filter((backup) => kinds.includes(backup.kind))
    .toSorted(newestFirst)
    .slice(0, count);
}

/**
 * The backups retention removes (keys spec, section 7.3): of the verified ones it keeps the
 * newest `daily` scheduled backups, the newest `weekly` Sunday backups and the newest
 * `beforeChanges` taken before an update or a migration; a backup in any of these sets stays. A
 * backup the owner took by hand stays until the owner removes it, and one never verified goes,
 * since no check passed on it.
 */
export function backupsToDrop(
  backups: readonly BackupRecord[],
  kept: BackupsKept,
): readonly BackupRecord[] {
  const verified = backups.filter((backup) => backup.verifiedAtMs !== undefined);
  const keep = new Set([
    ...newest(verified, ["daily", "weekly"], kept.daily),
    ...newest(verified, ["weekly"], kept.weekly),
    ...newest(verified, ["before_update", "before_migration"], kept.beforeChanges),
    ...verified.filter((backup) => backup.kind === "manual"),
  ]);
  return backups.filter((backup) => !keep.has(backup));
}
