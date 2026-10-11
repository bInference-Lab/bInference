import { randomUUID } from "node:crypto";
import { type FileHandle, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
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

// What a private file holds: text, bytes, or bytes that arrive in pieces, such as a stream.
type PrivateFileData = string | Uint8Array | AsyncIterable<Uint8Array>;

async function writeData(
  handle: FileHandle,
  data: PrivateFileData,
  signal: AbortSignal,
): Promise<void> {
  if (typeof data === "string" || data instanceof Uint8Array) {
    await handle.writeFile(data, { signal });
    return;
  }
  for await (const piece of data) {
    signal.throwIfAborted();
    await handle.write(piece);
  }
}

async function fillPrivately(
  temporary: string,
  data: PrivateFileData,
  options: PrivateFileOptions,
): Promise<void> {
  await (await open(temporary, "wx", 0o600)).close();
  // The file is owner-only before it holds a byte of the data.
  await options.permissions.restrictFile(temporary, options.signal);
  const handle = await open(temporary, "r+");
  try {
    await writeData(handle, data, options.signal);
    await handle.datasync();
  } finally {
    await handle.close();
  }
}

async function writePrivately(
  path: string,
  data: PrivateFileData,
  options: PrivateFileOptions,
): Promise<void> {
  options.signal.throwIfAborted();
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await fillPrivately(temporary, data, options);
    await rename(temporary, path);
    // A crash right after the rename must not bring the old file back.
    await options.permissions.syncFolder(dirname(path), options.signal);
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

/**
 * Writes a file only its owner can read, replacing any file at `path`. The data goes into a new
 * owner-only file beside it, which then takes its place, so no reader sees part of the data or a
 * looser access list; the folder is then synced, so the new file outlives a crash. The folder
 * must exist; make it with {@link ensurePrivateFolder}.
 */
export async function writePrivateFile(
  path: string,
  data: string | Uint8Array,
  options: PrivateFileOptions,
): Promise<void> {
  await writePrivately(path, data, options);
}

/**
 * Writes a file only its owner can read from bytes that arrive in pieces, such as an encrypted
 * stream, as {@link writePrivateFile} writes one: each piece goes to disk as it comes, so a large
 * file never sits in memory whole, and the file takes its place only once every piece is
 * written. A source that throws leaves the old file and no temporary file.
 */
export async function writePrivateStream(
  path: string,
  pieces: AsyncIterable<Uint8Array>,
  options: PrivateFileOptions,
): Promise<void> {
  await writePrivately(path, pieces, options);
}
