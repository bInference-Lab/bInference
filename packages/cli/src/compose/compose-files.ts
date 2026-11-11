import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { err, ok, type Result } from "@binference/core";
import type { FileCall, FileRefusal, MachineFiles, ReadFile } from "@binference/engine/shell";
import {
  type RealPathStep,
  readJudgedFile,
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
  /** How a path's real path is found: the platform's own unless a test passes its own. */
  readonly realPath?: RealPathStep;
}

/** Whether a path is under one of the folders, the folder itself included. */
function isInside(path: string, folders: readonly string[]): boolean {
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
async function realPlaceOf(parts: FileParts, path: string, signal: AbortSignal): Promise<string> {
  const real = await (parts.realPath ?? realPathOf)(path, signal);
  if (real !== undefined) {
    return real;
  }
  const parent = dirname(path);
  return parent === path ? path : join(await realPlaceOf(parts, parent, signal), basename(path));
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

// Whether a path lies inside an agent's skills folder, `<workspace>/<agent>/skills/`, where a
// skill changes only through a proposal the owner applies (decision 0408).
function isInSkillFolder(parts: FileParts, paths: readonly string[]): boolean {
  return paths.some((path) =>
    parts.walled.open.some((open) => {
      const inner = relative(open, path);
      const steps = inner.split(sep);
      return (
        !inner.startsWith("..") && !isAbsolute(inner) && steps.length >= 3 && steps[1] === "skills"
      );
    }),
  );
}

// The real path a write or a removal may use: one a read may use, outside the skills folders.
async function writePlaceOf(
  parts: FileParts,
  path: string,
  call: FileCall & { readonly keepLast?: boolean },
): Promise<Result<string, FileRefusal>> {
  const place = await placeOf(parts, path, call);
  if (!place.ok) {
    return place;
  }
  const asked = absoluteOf(parts, path);
  return isInSkillFolder(parts, [asked, place.value]) ? err("skill_folder") : place;
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
      ? join(await realPlaceOf(parts, dirname(absolute), call.signal), basename(absolute))
      : await realPlaceOf(parts, absolute, call.signal);
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
  // The file is judged again through the handle that reads it, as the path may lead elsewhere by
  // the time it is opened (decision 0410).
  const absolute = absoluteOf(parts, path);
  const read = await readJudgedFile(absolute, {
    maxBytes: call.maxBytes,
    signal: call.signal,
    judge: (real) => judge(parts, [absolute, real], call),
    ...(parts.realPath === undefined ? {} : { realPath: parts.realPath }),
  });
  if (read.kind === "read") {
    return ok({ path: read.realPath, bytes: read.bytes });
  }
  return err(read.kind === "refused" ? read.refusal : read.kind);
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
 * binference's own folder, whose workspace stays open, and none is written or removed in an agent's
 * skills folder (`skill_folder`, decision 0408). A read uses only the file it judged, through one
 * handle; a path that leads elsewhere by then is `changed` (decision 0410). A write replaces a file
 * whole and makes its folders; a removal removes a link itself and never a folder.
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
      const place = await writePlaceOf(parts, path, call);
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
      const place = await writePlaceOf(parts, path, { ...call, keepLast: true });
      if (!place.ok) {
        return place;
      }
      const removed = await removeOwnerFile(place.value, call.signal);
      return removed.ok ? ok(place.value) : removed;
    },
  };
}
