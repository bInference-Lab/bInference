import { err, ok, type Result } from "@binference/core";
import { foldText } from "./loose-characters.js";
import type { PatchHunk } from "./patch-parse.js";

// Ways to compare a file's line with a patch's line, strictest first: the first that finds a
// hunk's lines places it.
const comparisons: readonly ((line: string) => string)[] = [
  (line) => line,
  (line) => line.trimEnd(),
  (line) => line.trim(),
  (line) => foldText(line.trim()),
];

/** Where to look for a hunk's lines: from `from`, and first at the file's end for one tied there. */
interface Seek {
  readonly from: number;
  readonly atEnd: boolean;
}

function matchesAt(
  lines: readonly string[],
  at: number,
  wanted: { readonly pattern: readonly string[]; readonly same: (line: string) => string },
): boolean {
  const { pattern, same } = wanted;
  return pattern.every((line, index) => same(lines[at + index] ?? "") === same(line));
}

// The first index at or after `from` where `pattern` stands, by the strictest comparison that
// finds it.
function seek(
  lines: readonly string[],
  pattern: readonly string[],
  where: Seek,
): number | undefined {
  const last = lines.length - pattern.length;
  for (const same of comparisons) {
    if (where.atEnd && last >= where.from && matchesAt(lines, last, { pattern, same })) {
      return last;
    }
    for (let at = where.from; at <= last; at += 1) {
      if (matchesAt(lines, at, { pattern, same })) {
        return at;
      }
    }
  }
  return undefined;
}

/** One hunk placed: from which line, how many lines it takes out, and the lines it puts in. */
interface Replacement {
  readonly start: number;
  readonly count: number;
  readonly lines: readonly string[];
}

// Where the hunk's old lines stand, with a last empty line let go when only that keeps them out.
function placeHunk(
  lines: readonly string[],
  hunk: PatchHunk,
  from: number,
): Replacement | undefined {
  if (hunk.oldLines.length === 0) {
    return { start: lines.length, count: 0, lines: hunk.newLines };
  }
  const where = { from, atEnd: hunk.atEnd };
  const at = seek(lines, hunk.oldLines, where);
  if (at !== undefined) {
    return { start: at, count: hunk.oldLines.length, lines: hunk.newLines };
  }
  if (hunk.oldLines.at(-1) !== "") {
    return undefined;
  }
  const shorter = seek(lines, hunk.oldLines.slice(0, -1), where);
  const kept = hunk.newLines.at(-1) === "" ? hunk.newLines.slice(0, -1) : hunk.newLines;
  return shorter === undefined
    ? undefined
    : { start: shorter, count: hunk.oldLines.length - 1, lines: kept };
}

function placeAll(
  lines: readonly string[],
  hunks: readonly PatchHunk[],
  path: string,
): Result<readonly Replacement[], string> {
  const placed: Replacement[] = [];
  let from = 0;
  for (const [index, hunk] of hunks.entries()) {
    const named = `change ${String(index + 1)} of ${path}`;
    const anchorAt =
      hunk.anchor === undefined ? from : seek(lines, [hunk.anchor], { from, atEnd: false });
    if (anchorAt === undefined) {
      return err(`${named}: the line after @@ is not in the file`);
    }
    const start = hunk.anchor === undefined ? from : anchorAt + 1;
    const replacement = placeHunk(lines, hunk, start);
    if (replacement === undefined) {
      return err(`${named}: the lines it changes are not in the file; read the file again`);
    }
    placed.push(replacement);
    from = replacement.start + replacement.count;
  }
  return ok(placed);
}

/**
 * A file's text with a patch's hunks made, in order, each found after the one before (decision
 * 0386): exactly, else ignoring trailing spaces, then all outer spaces, then reading curly quotes,
 * dashes and special spaces as plain ones. A hunk with no old lines adds its lines at the end.
 * The text ends with a line break, written as the file wrote them. A hunk that is not found
 * answers which one, in the engine's words.
 */
export function applyHunks(
  content: string,
  hunks: readonly PatchHunk[],
  path: string,
): Result<string, string> {
  const crlf = content.includes("\r\n");
  const split = content.replaceAll("\r\n", "\n").split("\n");
  const lines = split.at(-1) === "" ? split.slice(0, -1) : split;
  const placed = placeAll(lines, hunks, path);
  if (!placed.ok) {
    return placed;
  }
  const next = [...lines];
  for (const each of placed.value.toReversed()) {
    next.splice(each.start, each.count, ...each.lines);
  }
  const text = next.length === 0 ? "" : `${next.join("\n")}\n`;
  return ok(crlf ? text.replaceAll("\n", "\r\n") : text);
}
