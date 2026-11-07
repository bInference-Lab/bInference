import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, rename, rm, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { err, ok, type Result } from "@binference/core";

/** Why an owner's file was not written: a file is there, the path is a folder, or the write failed. */
export type OwnerWriteRefusal = "exists" | "is_folder" | "unwritable";

/** Why an owner's file was not removed: nothing is there, it is a folder, or the removal failed. */
export type OwnerRemoveRefusal = "not_found" | "is_folder" | "unwritable";

const newFileMode = 0o644;

function codeOf(error: Error): string | undefined {
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
}

// What is at `path` now, without following a last link: nothing, a folder, or something else.
async function kindAt(path: string): Promise<"none" | "folder" | "other"> {
  try {
    return (await lstat(path)).isDirectory() ? "folder" : "other";
  } catch (error) {
    if (error instanceof Error && codeOf(error) === "ENOENT") {
      return "none";
    }
    throw error;
  }
}

// The mode a written file keeps: the one of the file there now, else the usual one for a new file.
async function modeFor(path: string): Promise<number> {
  try {
    return (await stat(path)).mode & 0o7777;
  } catch {
    return newFileMode;
  }
}

async function writeTemporary(
  path: string,
  bytes: Readonly<Uint8Array>,
  signal: AbortSignal,
): Promise<string> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", await modeFor(path));
  try {
    await handle.writeFile(Uint8Array.from(bytes), { signal });
    await handle.datasync();
  } finally {
    await handle.close();
  }
  return temporary;
}

/**
 * Writes an owner's file whole, as the agent's file tools do (decision 0386): its missing folders
 * are made, the bytes go into a new file beside it that then takes its place, so no reader sees
 * part of them, and a file that was there keeps its permissions. With `createOnly`, a path that
 * holds anything is `exists`, checked as the new file takes its place. Rejects with the signal's
 * reason once it aborts.
 */
export async function writeOwnerFile(
  path: string,
  bytes: Readonly<Uint8Array>,
  options: { readonly signal: AbortSignal; readonly createOnly?: boolean },
): Promise<Result<void, OwnerWriteRefusal>> {
  const { signal } = options;
  signal.throwIfAborted();
  let temporary: string | undefined;
  try {
    const kind = await kindAt(path);
    if (kind === "folder") {
      return err("is_folder");
    }
    if (options.createOnly === true && kind !== "none") {
      return err("exists");
    }
    await mkdir(dirname(path), { recursive: true });
    temporary = await writeTemporary(path, bytes, signal);
    // A link fails when anything took the path meanwhile; a rename would replace it.
    await (options.createOnly === true ? link(temporary, path) : rename(temporary, path));
    return ok(undefined);
  } catch (error) {
    signal.throwIfAborted();
    return error instanceof Error && codeOf(error) === "EEXIST" ? err("exists") : err("unwritable");
  } finally {
    if (temporary !== undefined) {
      await rm(temporary, { force: true });
    }
  }
}

/**
 * Removes an owner's file, as the agent's file tools do (decision 0386): a link is removed
 * itself, never what it leads to, and a folder is never removed. Rejects with the signal's reason
 * once it aborts.
 */
export async function removeOwnerFile(
  path: string,
  signal: AbortSignal,
): Promise<Result<void, OwnerRemoveRefusal>> {
  signal.throwIfAborted();
  try {
    const kind = await kindAt(path);
    if (kind !== "other") {
      return err(kind === "folder" ? "is_folder" : "not_found");
    }
    await unlink(path);
    return ok(undefined);
  } catch {
    signal.throwIfAborted();
    return err("unwritable");
  }
}
