import { BinferenceError, err, ok, type Result } from "@binference/core";
import { readFilePieces } from "@binference/platform";
import { checkArchive } from "./check-archive.js";
import { openBody } from "./chunk-stream.js";
import { splitHeader } from "./header-line.js";
import type { WrittenBackup } from "./write-backup.js";

/**
 * Reads a backup file back right after it was written, with the data key the writer still holds
 * (keys spec, section 7.3): the same header line, every chunk's tag, and every file's size and
 * SHA-256 against a manifest equal to the one written. Never needs the owner key. A file that
 * does not match is `check_failed`; a file that cannot be read throws.
 */
export async function verifyBackup(
  target: string,
  written: WrittenBackup,
  signal: AbortSignal,
): Promise<Result<void, "check_failed">> {
  const split = await splitHeader(readFilePieces(target, { signal }));
  if (!split.ok) {
    return err("check_failed");
  }
  if (!Buffer.from(split.value.line).equals(written.line)) {
    await split.value.close();
    return err("check_failed");
  }
  try {
    const manifest = await checkArchive(openBody(split.value.body, written.dataKey, written.frame));
    return JSON.stringify(manifest) === JSON.stringify(written.manifest)
      ? ok(undefined)
      : err("check_failed");
  } catch (error) {
    if (error instanceof BinferenceError && error.code.startsWith("backup.")) {
      return err("check_failed");
    }
    throw error;
  }
}
