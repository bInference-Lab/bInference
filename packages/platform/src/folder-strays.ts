import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { BinferenceError } from "@binference/core";

// A plugin's package holds a few hundred entries; past this the walk is a fault, never a hang.
const maxEntries = 100_000;

// Whether an entry is a plain file only it names: a second hard link shares its bytes with a
// path outside the folder, which can change them unseen.
async function isLoneFile(path: string): Promise<boolean> {
  const stats = await lstat(path);
  return stats.isFile() && stats.nlink === 1;
}

async function strayOf(entry: Dirent, path: string): Promise<boolean> {
  if (entry.isDirectory()) {
    return false;
  }
  return !(entry.isFile() && (await isLoneFile(path)));
}

async function walk(folder: string, signal: AbortSignal): Promise<string[]> {
  const strays: string[] = [];
  const waiting: string[] = [""];
  let seen = 0;
  for (let inner = waiting.pop(); inner !== undefined; inner = waiting.pop()) {
    signal.throwIfAborted();
    // oxlint-disable-next-line eslint/no-await-in-loop -- one level at a time keeps the walk bounded
    const entries = await readdir(join(folder, inner), { withFileTypes: true });
    seen += entries.length;
    if (seen > maxEntries) {
      throw new BinferenceError({
        code: "platform.too_many_files",
        message: `${folder} holds more than ${String(maxEntries)} files and folders.`,
        details: { folder },
      });
    }
    for (const entry of entries) {
      const path = inner === "" ? entry.name : `${inner}/${entry.name}`;
      // oxlint-disable-next-line eslint/no-await-in-loop -- each entry is read once, in order
      if (await strayOf(entry, join(folder, path))) {
        strays.push(path);
      } else if (entry.isDirectory()) {
        waiting.push(path);
      }
    }
  }
  return strays;
}

/**
 * Every entry under `folder`, at any depth, that is neither a folder nor a regular file with one
 * link: a symbolic link, a junction, a second hard link to a file, a socket, a pipe or a device,
 * as a path relative to it with `/` between its parts, sorted. A link is listed and never
 * followed. A folder of plain files lists nothing. A folder that is not there, or one it cannot
 * read, is `platform.folder_read_failed`; more than 100,000 entries is
 * `platform.too_many_files`.
 */
export async function findFolderStrays(
  folder: string,
  signal: AbortSignal,
): Promise<readonly string[]> {
  signal.throwIfAborted();
  try {
    return (await walk(folder, signal)).toSorted();
  } catch (error) {
    throw error instanceof BinferenceError || signal.aborted
      ? error
      : new BinferenceError({
          code: "platform.folder_read_failed",
          message: `Could not read ${folder}; check that it is a folder you can read.`,
          cause: error,
          details: { folder },
        });
  }
}
