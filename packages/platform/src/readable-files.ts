import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, rm } from "node:fs/promises";
import { BinferenceError } from "@binference/core";

/**
 * Creates a folder and any missing parents that every account may read and only its owner may
 * change (mode `0755` on macOS and Linux), whether it is new or was there before: for files
 * another OS user must read, such as a community plugin's package the image's plugin user runs.
 */
export async function ensureReadableFolder(path: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  try {
    await mkdir(path, { recursive: true, mode: 0o755 });
    await chmod(path, 0o755);
  } catch (error) {
    throw new BinferenceError({
      code: "platform.folder_failed",
      message: `Could not create ${path}; check the permissions of its parent folder.`,
      cause: error,
      details: { path },
    });
  }
}

/**
 * Writes a file every account may read and only its owner may change (mode `0644` on macOS and
 * Linux), replacing any file at `path`: the bytes go into a new file beside it, which then takes
 * its place, so no reader sees part of them. The folder must exist; make it with
 * {@link ensureReadableFolder}. Never for a secret: use `writePrivateFile`.
 */
export async function writeReadableFile(
  path: string,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o644);
    try {
      await handle.writeFile(bytes, { signal });
      await handle.chmod(0o644);
      await handle.datasync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw signal.aborted
      ? error
      : new BinferenceError({
          code: "platform.file_write_failed",
          message: `Could not write ${path}; check that its folder exists and is yours.`,
          cause: error,
          details: { path },
        });
  }
}
