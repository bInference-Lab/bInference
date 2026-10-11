import type { Id } from "@binference/core";
import type { BackupKind } from "@binference/engine/backups";

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A backup's file name (keys spec, section 7.2): `binference-<install id>-<yyyymmdd-hhmm>-<kind>`
 * with the time in UTC, so a name reads the same on every machine, and `.bnfbak`. A second backup
 * of one kind in the same minute takes `-2`, `-3` and on before the extension, so no backup ever
 * writes over another.
 */
export function backupFileName(
  backup: {
    readonly installId: Id<"ins">;
    readonly createdAtMs: number;
    readonly kind: BackupKind;
  },
  taken: number,
): string {
  const at = new Date(backup.createdAtMs);
  const day = `${String(at.getUTCFullYear())}${twoDigits(at.getUTCMonth() + 1)}${twoDigits(at.getUTCDate())}`;
  const time = `${twoDigits(at.getUTCHours())}${twoDigits(at.getUTCMinutes())}`;
  const suffix = taken > 1 ? `-${String(taken)}` : "";
  return `binference-${backup.installId}-${day}-${time}-${backup.kind}${suffix}.bnfbak`;
}
