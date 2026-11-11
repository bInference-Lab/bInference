import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, realpath, rename, rm, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { err, ok, type Result } from "@binference/core";

/**
 * Why an owner's file was not written: a file is there, the path is a folder, its folder led
 * elsewhere by the time of the write (decision 0410), or the write failed.
 */
export type OwnerWriteRefusal = "exists" | "is_folder" | "changed" | "unwritable";

/**
 * Why an owner's file was not removed: nothing is there, it is a folder, its folder led elsewhere
 * by the time of the removal (decision 0410), or the removal failed.
 */
export type OwnerRemoveRefusal = "not_found" | "is_folder" | "changed" | "unwritable";

// A new file takes the process's file mode mask, as any program's does: 0644 under the usual 022,
// and writable to the group under the Docker image's 0002, whose workspace the agent's commands
// share through that group (decision 0412).
const newFileMode = 0o666;

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

// The real path of the folder `path` names now, or `undefined` when it is gone.
async function realFolderOf(path: string): Promise<string | undefined> {
  try {
    return await realpath(dirname(path));
  } catch {
    return undefined;
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

// Puts the new file, made beside `path` under the name `temporary`, in its place.
async function putInPlace(
  path: string,
  temporary: string,
  options: { readonly createOnly?: boolean },
): Promise<Result<void, OwnerWriteRefusal>> {
  const folder = dirname(path);
  // The folder is checked once the new file exists under its random name: a folder that moved
  // before holds it where the check finds it, and one that moves after cannot take the rename,
  // which reaches the new file only by that name in the folder judged.
  const landed = await realFolderOf(join(folder, temporary));
  if (landed !== folder) {
    await rm(join(landed ?? folder, temporary), { force: true });
    return err("changed");
  }
  const placed = join(folder, temporary);
  // A link fails when anything took the path meanwhile; a rename would replace it.
  await (options.createOnly === true ? link(placed, path) : rename(placed, path));
  return ok(undefined);
}

/**
 * Writes an owner's file whole, as the agent's file tools do (decision 0386): its missing folders
 * are made, the bytes go into a new file beside it that then takes its place, so no reader sees
 * part of them, and a file that was there keeps its permissions. `path` is the real path the
 * caller judged, every link on the way resolved: the file lands in its folder or nowhere, and a
 * folder that leads elsewhere by then is `changed` (decision 0410). With `createOnly`, a path that
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
  const folder = dirname(path);
  let temporary: string | undefined;
  try {
    const kind = await kindAt(path);
    if (kind === "folder") {
      return err("is_folder");
    }
    if (options.createOnly === true && kind !== "none") {
      return err("exists");
    }
    await mkdir(folder, { recursive: true });
    temporary = basename(await writeTemporary(path, bytes, signal));
    return await putInPlace(path, temporary, options);
  } catch (error) {
    signal.throwIfAborted();
    return error instanceof Error && codeOf(error) === "EEXIST" ? err("exists") : err("unwritable");
  } finally {
    if (temporary !== undefined) {
      await rm(join(folder, temporary), { force: true });
    }
  }
}

// Moves the entry at `path` aside under a random name, and removes it only from the folder judged;
// an entry that went elsewhere goes back by the real path of the folder it went to.
async function removeFromFolder(path: string): Promise<Result<void, OwnerRemoveRefusal>> {
  const folder = dirname(path);
  const aside = `${basename(path)}.${randomUUID()}.removing`;
  await rename(path, join(folder, aside));
  const landed = await realFolderOf(join(folder, aside));
  if (landed === folder) {
    await unlink(join(folder, aside));
    return ok(undefined);
  }
  if (landed !== undefined) {
    await rename(join(landed, aside), join(landed, basename(path)));
  }
  return err("changed");
}

/**
 * Removes an owner's file, as the agent's file tools do (decision 0386): a link is removed
 * itself, never what it leads to, and a folder is never removed. `path` is the real path the
 * caller judged, its last part left as it is: the entry is moved aside under a random name and
 * removed only when it is in that path's folder, else it is put back and the removal is
 * `changed` (decision 0410). Rejects with the signal's reason once it aborts.
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
    return await removeFromFolder(path);
  } catch {
    signal.throwIfAborted();
    return err("unwritable");
  }
}
