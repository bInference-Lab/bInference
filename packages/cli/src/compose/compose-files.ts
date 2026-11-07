import { basename, dirname, isAbsolute, join, sep } from "node:path";
import { err, ok, type Result } from "@binference/core";
import type { FileCall, FileRefusal, MachineFiles, ReadFile } from "@binference/engine/shell";
import {
  isFolder,
  readFileBytes,
  realPathOf,
  removeOwnerFile,
  type WalledPaths,
  writeOwnerFile,
} from "@binference/platform";

/** Where the agent's files are on this machine. */
export interface FileParts {
  /** binference's own folder, walled off, and its workspace, which stays open. */
  readonly walled: WalledPaths;
  /** The agent's workspace, where a relative path starts. */
  readonly workspace: string;
  readonly homeDir: string;
}

/** Whether a path is under one of the folders, the folder itself included. */
export function isInside(path: string, folders: readonly string[]): boolean {
  return folders.some((folder) => path === folder || path.startsWith(`${folder}${sep}`));
}

// A path as the agent writes it: `~` and `~/` are the home folder, a relative one is in the
// workspace.
function absoluteOf(parts: FileParts, path: string): string {
  if (path === "~" || path.startsWith("~/")) {
    return join(parts.homeDir, path.slice(1));
  }
  return isAbsolute(path) ? path : join(parts.workspace, path);
}

// The real path of a place that may not exist yet: the nearest folder that does, links resolved,
// with the rest of the path after it, so no link on the way leads into a walled folder.
async function realPlaceOf(path: string, signal: AbortSignal): Promise<string> {
  const real = await realPathOf(path, signal);
  if (real !== undefined) {
    return real;
  }
  const parent = dirname(path);
  return parent === path ? path : join(await realPlaceOf(parent, signal), basename(path));
}

function judge(
  parts: FileParts,
  places: readonly string[],
  call: FileCall,
): FileRefusal | undefined {
  const { roots, open } = parts.walled;
  if (places.some((place) => isInside(place, roots) && !isInside(place, open))) {
    return "walled";
  }
  return call.workspaceOnly && places.some((place) => !isInside(place, open))
    ? "outside_workspace"
    : undefined;
}

// The real path a call may use, or why not; with `keepLast`, a last link stays itself.
async function placeOf(
  parts: FileParts,
  path: string,
  call: FileCall & { readonly keepLast?: boolean },
): Promise<Result<string, FileRefusal>> {
  call.signal.throwIfAborted();
  const absolute = absoluteOf(parts, path);
  const real =
    call.keepLast === true
      ? join(await realPlaceOf(dirname(absolute), call.signal), basename(absolute))
      : await realPlaceOf(absolute, call.signal);
  const refusal = judge(parts, [absolute, real], call);
  return refusal === undefined ? ok(real) : err(refusal);
}

async function readOne(
  parts: FileParts,
  path: string,
  call: FileCall & { readonly maxBytes: number },
): Promise<Result<ReadFile, FileRefusal>> {
  const place = await placeOf(parts, path, call);
  if (!place.ok) {
    return place;
  }
  if (isFolder(place.value)) {
    return err("is_folder");
  }
  const read = await readFileBytes(place.value, { maxBytes: call.maxBytes, signal: call.signal });
  return read.ok ? ok({ path: place.value, bytes: read.value }) : read;
}

// The narrow space macOS writes before AM or PM in a screenshot's name, and a no-break space.
const narrowSpaces = /[\u00A0\u202F]/gu;
const curlyQuotes: readonly (readonly [RegExp, string])[] = [
  [/[\u2018\u2019]/gu, "'"],
  [/[\u201C\u201D]/gu, '"'],
];

/**
 * Other spellings of a path's last part that a person or a model may have meant: its composed and
 * decomposed Unicode forms, plain spaces for narrow and no-break ones and the other way, and
 * straight quotes for curly ones.
 */
function otherSpellings(path: string): readonly string[] {
  const folder = dirname(path);
  const name = basename(path);
  const plain = curlyQuotes.reduce(
    (text, [curly, straight]) => text.replace(curly, straight),
    name,
  );
  const names = [
    name.normalize("NFC"),
    name.normalize("NFD"),
    name.replace(narrowSpaces, " "),
    name.replace(/ (?=[AP]M\b)/gu, "\u202F"),
    plain,
  ];
  const kept = [...new Set(names)].filter((each) => each !== name);
  return kept.map((each) => join(folder, each));
}

/**
 * The agent's files on this machine (decision 0386): a path absolute, under the home folder by
 * `~/`, or in the workspace when relative, each read at its real path, so no link leads into
 * binference's own folder, whose workspace stays open. A write replaces a file whole and makes its
 * folders; a removal removes a link itself and never a folder.
 */
export function machineFilesOf(parts: FileParts): MachineFiles {
  return {
    read: async (path, call) => {
      const first = await readOne(parts, path, call);
      if (first.ok || first.error !== "not_found") {
        return first;
      }
      // A name typed with another form of the same characters reads the file it means.
      for (const other of otherSpellings(path)) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- the first spelling that reads wins
        const read = await readOne(parts, other, call);
        if (read.ok || read.error !== "not_found") {
          return read;
        }
      }
      return first;
    },
    write: async (path, bytes, call) => {
      const place = await placeOf(parts, path, call);
      if (!place.ok) {
        return place;
      }
      const written = await writeOwnerFile(place.value, bytes, {
        signal: call.signal,
        ...(call.createOnly === undefined ? {} : { createOnly: call.createOnly }),
      });
      return written.ok ? ok(place.value) : written;
    },
    remove: async (path, call) => {
      const place = await placeOf(parts, path, { ...call, keepLast: true });
      if (!place.ok) {
        return place;
      }
      const removed = await removeOwnerFile(place.value, call.signal);
      return removed.ok ? ok(place.value) : removed;
    },
  };
}
