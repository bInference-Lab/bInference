import { dirname, join } from "node:path";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import { ensurePrivateFolder, writePrivateStream } from "@binference/platform";
import type { BackupManifest } from "./backup-manifest.schema.js";
import { checkArchive } from "./check-archive.js";
import { openBody } from "./chunk-stream.js";
import type { OpenedBackup } from "./open-backup.js";
import type { BackupWriting } from "./write-backup.js";

/**
 * Decrypts an opened backup into `folder` (keys spec, section 7.4, step 2): each file of its
 * archive at its path there, owner-only, while every chunk's tag and every file's SHA-256 are
 * checked against the manifest. A backup that does not check is `damaged`, and what it wrote in
 * `folder` must not be used. The data key is zeroed once the body is read, whatever the outcome.
 */
export async function unpackBackup(
  opened: OpenedBackup,
  folder: string,
  writing: BackupWriting,
): Promise<Result<BackupManifest, "damaged">> {
  try {
    await ensurePrivateFolder(folder, writing);
    const manifest = await checkArchive(
      openBody(opened.body, opened.dataKey, opened.frame),
      async (entry, content) => {
        const target = join(folder, ...entry.path.split("/"));
        await ensurePrivateFolder(dirname(target), writing);
        await writePrivateStream(target, content, writing);
      },
    );
    return ok(manifest);
  } catch (error) {
    if (error instanceof BinferenceError && error.code.startsWith("backup.")) {
      return err("damaged");
    }
    throw error;
  } finally {
    opened.dataKey.fill(0);
    await opened.close();
  }
}
