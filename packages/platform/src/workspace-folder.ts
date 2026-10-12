import { randomUUID } from "node:crypto";
import { link, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  BinferenceError,
  checkWorkspacePlace,
  err,
  ok,
  type WorkspaceFiles,
  type WorkspacePlace,
} from "@binference/core";
import type { FilePermissions } from "./ports.js";
import { ensurePrivateFolder, writePrivateFile } from "./private-files.js";
import { readTextFile } from "./read-text-file.js";

/** Where the workspace folder is, and this OS's owner-only permissions. */
export interface WorkspaceFolderOptions {
  /** The state folder's `workspace/`. */
  readonly root: string;
  readonly permissions: FilePermissions;
}

// A link to a name that is taken fails with `EEXIST`.
function isExisting(error: Error): boolean {
  return "code" in error && error.code === "EEXIST";
}

async function changedAt(path: string): Promise<number> {
  return Math.floor((await stat(path)).mtimeMs);
}

// The agent's folder, made owner-only when it is new, and the file's path in it.
async function placeOf(
  options: WorkspaceFolderOptions,
  place: WorkspacePlace,
  signal: AbortSignal,
): Promise<string> {
  checkWorkspacePlace(place);
  const folder = join(options.root, place.agent);
  await ensurePrivateFolder(folder, { permissions: options.permissions, signal });
  return join(folder, place.file);
}

// The text goes into an owner-only file beside the place, which is then linked into it: a link
// fails when a file is there, so two creates never both win and a reader never sees part of it.
async function createAt(
  path: string,
  text: string,
  options: { readonly permissions: FilePermissions; readonly signal: AbortSignal },
): Promise<boolean> {
  const draft = `${path}.${randomUUID()}.new`;
  await writePrivateFile(draft, text, options);
  try {
    await link(draft, path);
    return true;
  } catch (error) {
    if (error instanceof Error && isExisting(error)) {
      return false;
    }
    throw new BinferenceError({
      code: "platform.file_write_failed",
      message: `Could not write ${path}; check that its folder exists and is yours.`,
      cause: error,
      details: { path },
    });
  } finally {
    await rm(draft, { force: true });
  }
}

/**
 * Creates the {@link WorkspaceFiles} over the state folder's `workspace/`: one owner-only folder
 * per agent, named by its id, each file UTF-8 text of at most 1 MiB. A write replaces the file
 * whole (`writePrivateFile`), and the time a file changed is its modification time.
 */
export function createWorkspaceFolder(options: WorkspaceFolderOptions): WorkspaceFiles {
  const { permissions } = options;
  return {
    async read(place, signal) {
      checkWorkspacePlace(place);
      const path = join(options.root, place.agent, place.file);
      const read = await readTextFile(path, signal);
      return read.ok ? ok({ text: read.value, updatedAtMs: await changedAt(path) }) : read;
    },
    async write(place, text, signal) {
      const path = await placeOf(options, place, signal);
      await writePrivateFile(path, text, { permissions, signal });
      return changedAt(path);
    },
    async create(place, text, signal) {
      const path = await placeOf(options, place, signal);
      const made = await createAt(path, text, { permissions, signal });
      if (made) {
        await permissions.syncFolder(join(options.root, place.agent), signal);
      }
      return made ? ok(await changedAt(path)) : err("exists");
    },
  };
}
