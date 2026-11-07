import { err, ok, type Result } from "@binference/core";
import { itemAt } from "./item-at.js";

/** One change to a file's lines: the lines it expects and the lines that take their place. */
export interface PatchHunk {
  /** A line the change follows, written after `@@`, which places it in a long file. */
  readonly anchor?: string;
  readonly oldLines: readonly string[];
  readonly newLines: readonly string[];
  /**
   * Each context line as a pair of its place in `newLines` and in `oldLines`, so a loose match
   * keeps the file's own text of the lines the hunk does not change.
   */
  readonly kept: readonly (readonly [number, number])[];
  /** The change runs to the end of the file. */
  readonly atEnd: boolean;
}

/** One file operation of a patch. */
export type PatchOperation =
  | { readonly kind: "add"; readonly path: string; readonly lines: readonly string[] }
  | { readonly kind: "delete"; readonly path: string }
  | {
      readonly kind: "update";
      readonly path: string;
      readonly moveTo?: string;
      readonly hunks: readonly PatchHunk[];
    };

// What a reader made, and the index of the first line it left.
interface Read<T> {
  readonly value: T;
  readonly next: number;
}

type Reading<T> = Result<Read<T>, string>;

const begin = "*** Begin Patch";
const end = "*** End Patch";
const addFile = "*** Add File: ";
const deleteFile = "*** Delete File: ";
const updateFile = "*** Update File: ";
const moveTo = "*** Move to: ";
const endOfFile = "*** End of File";

const isHeader = (line: string): boolean => line.startsWith("*** ");
const lineNumber = (index: number): string => String(index + 2);

function pathAfter(line: string, prefix: string): Result<string, string> {
  const path = line.slice(prefix.length).trim();
  return path === "" ? err(`"${prefix.trim()}" names no file`) : ok(path);
}

function readAdd(lines: readonly string[], at: number, path: string): Reading<PatchOperation> {
  const added: string[] = [];
  let next = at;
  while (next < lines.length && !isHeader(itemAt(lines, next, ""))) {
    const line = itemAt(lines, next, "");
    if (!line.startsWith("+")) {
      return err(`line ${lineNumber(next)}, in the new file ${path}, does not start with +`);
    }
    added.push(line.slice(1));
    next += 1;
  }
  return ok({ value: { kind: "add", path, lines: added }, next });
}

// A hunk line's place: in the old lines, the new lines, or both; an empty line is empty context.
function sidesOf(line: string): { readonly old: boolean; readonly new: boolean } | undefined {
  const sides: Readonly<Record<string, { readonly old: boolean; readonly new: boolean }>> = {
    " ": { old: true, new: true },
    "": { old: true, new: true },
    "-": { old: true, new: false },
    "+": { old: false, new: true },
  };
  return sides[line.charAt(0)];
}

const endsHunk = (line: string | undefined): boolean =>
  line === undefined || line === endOfFile || line.startsWith("@@") || isHeader(line);

// One hunk's lines after its `@@` line, up to the next `@@`, header or end of file mark.
function readHunk(lines: readonly string[], at: number, anchor?: string): Reading<PatchHunk> {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  const kept: (readonly [number, number])[] = [];
  const anchored = anchor === undefined ? {} : { anchor };
  let next = at;
  while (!endsHunk(lines[next])) {
    const line = itemAt(lines, next, "");
    const sides = sidesOf(line);
    if (sides === undefined) {
      return err(`line ${lineNumber(next)} starts with none of " ", "-" and "+"`);
    }
    if (sides.old) {
      oldLines.push(line.slice(1));
    }
    if (sides.new) {
      newLines.push(line.slice(1));
    }
    if (sides.old && sides.new) {
      kept.push([newLines.length - 1, oldLines.length - 1]);
    }
    next += 1;
  }
  const atEnd = lines[next] === endOfFile;
  const value = { ...anchored, oldLines, newLines, kept, atEnd };
  return ok({ value, next: atEnd ? next + 1 : next });
}

function readHunks(
  lines: readonly string[],
  at: number,
  path: string,
): Reading<readonly PatchHunk[]> {
  const hunks: PatchHunk[] = [];
  let next = at;
  while (next < lines.length && !isHeader(itemAt(lines, next, ""))) {
    const line = itemAt(lines, next, "");
    const anchor = line.startsWith("@@") ? line.slice(2).trim() : "";
    const hunk = readHunk(lines, line.startsWith("@@") ? next + 1 : next, anchor || undefined);
    if (!hunk.ok) {
      return hunk;
    }
    hunks.push(hunk.value.value);
    next = hunk.value.next;
  }
  return hunks.length === 0
    ? err(`the update of ${path} holds no change`)
    : ok({ value: hunks, next });
}

function readUpdate(lines: readonly string[], at: number, path: string): Reading<PatchOperation> {
  const first = lines[at] ?? "";
  const target = first.startsWith(moveTo) ? pathAfter(first, moveTo) : undefined;
  if (target?.ok === false) {
    return target;
  }
  const hunks = readHunks(lines, target === undefined ? at : at + 1, path);
  if (!hunks.ok) {
    return hunks;
  }
  const move = target === undefined ? {} : { moveTo: target.value };
  return ok({
    value: { kind: "update", path, ...move, hunks: hunks.value.value },
    next: hunks.value.next,
  });
}

type OperationReader = (
  lines: readonly string[],
  at: number,
  path: string,
) => Reading<PatchOperation>;

const readers: readonly (readonly [string, OperationReader])[] = [
  [addFile, readAdd],
  [deleteFile, (_lines, at, path) => ok({ value: { kind: "delete", path }, next: at })],
  [updateFile, readUpdate],
];

function readOperation(lines: readonly string[], at: number): Reading<PatchOperation> {
  const line = itemAt(lines, at, "");
  const reader = readers.find(([prefix]) => line.startsWith(prefix));
  if (reader === undefined) {
    return err(
      `line ${lineNumber(at)} is no file header: "*** Add File:", "*** Update File:" or "*** Delete File:"`,
    );
  }
  const path = pathAfter(line, reader[0]);
  return path.ok ? reader[1](lines, at + 1, path.value) : path;
}

// A patch written as a shell heredoc, `<<'EOF'` to `EOF`, read as the patch inside it.
function withoutHeredoc(lines: readonly string[]): readonly string[] {
  const word = /^<<-?\s*['"]?([A-Za-z_]\w*)['"]?\s*$/.exec(itemAt(lines, 0, ""))?.[1];
  return word !== undefined && lines.at(-1)?.trim() === word ? lines.slice(1, -1) : lines;
}

/**
 * Reads a patch (decision 0386): `*** Begin Patch`, then file operations, then `*** End Patch`.
 * `*** Add File: <path>` takes `+` lines; `*** Delete File: <path>` takes none; `*** Update File:
 * <path>`, with an optional `*** Move to: <path>` right after it, takes hunks that each start
 * with `@@` and an optional line they follow, lines of ` ` context, `-` removed and `+` added, and
 * an optional `*** End of File` that ties the hunk to the file's end. A patch it cannot read
 * answers why, in the engine's words.
 */
export function parsePatch(input: string): Result<readonly PatchOperation[], string> {
  const all = withoutHeredoc(input.replaceAll("\r\n", "\n").trim().split("\n"));
  if (all[0]?.trim() !== begin || all.at(-1)?.trim() !== end) {
    return err(`a patch starts with "${begin}" and ends with "${end}"`);
  }
  const lines = all.slice(1, -1);
  const operations: PatchOperation[] = [];
  let next = 0;
  while (next < lines.length) {
    const operation = readOperation(lines, next);
    if (!operation.ok) {
      return operation;
    }
    operations.push(operation.value.value);
    next = operation.value.next;
  }
  return operations.length === 0 ? err("the patch changes no file") : ok(operations);
}
