import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { BinferenceError } from "@binference/core";
import type { FilePermissions } from "./ports.js";

/** What an owner-only write needs: this OS's permissions and a deadline. */
export interface PrivateFileOptions {
  readonly permissions: FilePermissions;
  readonly signal: AbortSignal;
}

/**
 * Creates a folder and any missing parents, then restricts the folder to its owner, whether it is
 * new or was there before. Created parents get mode `0700` on macOS and Linux.
 */
export async function ensurePrivateFolder(
  path: string,
  options: PrivateFileOptions,
): Promise<void> {
  options.signal.throwIfAborted();
  try {
    await mkdir(path, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new BinferenceError({
      code: "platform.folder_failed",
      message: `Could not create ${path}; check the permissions of its parent folder.`,
      cause: error,
      details: { path },
    });
  }
  await options.permissions.restrictFolder(path, options.signal);
}

async function fillPrivately(
  temporary: string,
  data: string | Uint8Array,
  options: PrivateFileOptions,
): Promise<void> {
  await (await open(temporary, "wx", 0o600)).close();
  // The file is owner-only before it holds a byte of the data.
  await options.permissions.restrictFile(temporary, options.signal);
  const handle = await open(temporary, "r+");
  try {
    await handle.writeFile(data, { signal: options.signal });
    await handle.datasync();
  } finally {
    await handle.close();
  }
}

/**
 * Writes a file only its owner can read, replacing any file at `path`. The data goes into a new
 * owner-only file beside it, which then takes its place, so no reader sees part of the data or a
 * looser access list. The folder must exist; make it with {@link ensurePrivateFolder}.
 */
export async function writePrivateFile(
  path: string,
  data: string | Uint8Array,
  options: PrivateFileOptions,
): Promise<void> {
  options.signal.throwIfAborted();
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await fillPrivately(temporary, data, options);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error instanceof BinferenceError || options.signal.aborted
      ? error
      : new BinferenceError({
          code: "platform.file_write_failed",
          message: `Could not write ${path}; check that its folder exists and is yours.`,
          cause: error,
          details: { path },
        });
  }
}
