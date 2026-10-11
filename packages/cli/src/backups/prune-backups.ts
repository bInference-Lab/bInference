import { basename, join } from "node:path";
import { BinferenceError } from "@binference/core";
import { removePath } from "@binference/platform";
import type { BackupParts } from "./backup-parts.js";
import { backupsToDrop, type BackupsKept } from "./backup-retention.js";

/**
 * Applies retention (keys spec, section 7.3) once a backup is verified: each backup it no longer
 * keeps loses its file, its copy in `copyTo` when there is one, then its record. A file that
 * cannot be removed keeps its record, so the next run tries again; that is logged, never a
 * failed backup.
 */
export async function pruneBackups(
  parts: Pick<BackupParts, "backups" | "logger">,
  run: { readonly kept: BackupsKept; readonly copyTo?: string; readonly signal: AbortSignal },
): Promise<void> {
  const { signal } = run;
  const dropped = backupsToDrop(await parts.backups.list({ signal }), run.kept);
  const gone = await Promise.all(
    dropped.map(async (backup) => {
      try {
        await removePath(backup.path, signal);
        if (run.copyTo !== undefined) {
          await removePath(join(run.copyTo, basename(backup.path)), signal);
        }
        return [backup.id];
      } catch (error) {
        const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
        parts.logger.warn("backup.prune_failed", { errorCode });
        return [];
      }
    }),
  );
  await parts.backups.forget(gone.flat(), { signal });
}
