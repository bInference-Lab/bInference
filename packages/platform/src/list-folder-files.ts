import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { BinferenceError } from "@binference/core";

// A folder of agents' files holds hundreds; past this the listing is a fault, never a hang.
const maxEntries = 100_000;

function isMissing(error: Error): boolean {
  return "code" in error && error.code === "ENOENT";
}

function tooMany(folder: string): BinferenceError {
  return new BinferenceError({
    code: "platform.too_many_files",
    message: `${folder} holds more than ${String(maxEntries)} files and folders.`,
    details: { folder },
  });
}

// The entries of an inner folder; one removed while the walk runs holds none.
async function readInner(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && isMissing(error)) {
      return [];
    }
    throw error;
  }
}

// Walks one folder level at a time. A link's entry is neither a file nor a folder, so a link is
// never listed and never entered: Node's own recursive listing enters linked folders.
async function walk(folder: string, signal: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  const waiting: string[] = [""];
  let seen = 0;
  for (let inner = waiting.pop(); inner !== undefined; inner = waiting.pop()) {
    signal.throwIfAborted();
    // oxlint-disable-next-line eslint/no-await-in-loop -- one level at a time keeps the walk bounded
    const entries = await (inner === ""
      ? readdir(folder, { withFileTypes: true })
      : readInner(join(folder, inner)));
    seen += entries.length;
    if (seen > maxEntries) {
      throw tooMany(folder);
    }
    for (const entry of entries) {
      const path = inner === "" ? entry.name : `${inner}/${entry.name}`;
      if (entry.isDirectory()) {
        waiting.push(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }
  return files;
}

/**
 * Every regular file under `folder`, at any depth, as a path relative to it with `/` between its
 * parts on every OS, sorted. Links are never followed or listed, so nothing outside the folder
 * comes in. A missing folder lists nothing. More than 100,000 entries is
 * `platform.too_many_files`; a folder it cannot read is `platform.folder_read_failed`.
 */
export async function listFolderFiles(
  folder: string,
  signal: AbortSignal,
): Promise<readonly string[]> {
  signal.throwIfAborted();
  try {
    return (await walk(folder, signal)).toSorted();
  } catch (error) {
    if (error instanceof Error && isMissing(error)) {
      return [];
    }
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
