import { err, ok, type Result } from "@binference/core";
import { byteOrderMark } from "./byte-order-mark.js";
import { itemAt } from "./item-at.js";
import { foldText } from "./loose-characters.js";
import type { PatchHunk } from "./patch-parse.js";

/** One line of a file: its text and the line break that ends it, empty for a last line without. */
interface FileLine {
  readonly text: string;
  readonly ending: string;
}

/** A file read into lines, with its byte order mark and the line break it writes most. */
interface FileLines {
  readonly bom: string;
  readonly lines: readonly FileLine[];
  readonly ending: string;
}

// Ways to compare a file's line with a patch's line, strictest first: the first that finds a
// hunk's lines decides, and finding them more than once there is ambiguous.
const comparisons: readonly ((line: string) => string)[] = [
  (line) => line,
  (line) => line.trimEnd(),
  (line) => line.trim(),
  (line) => foldText(line.trim()),
];

/** Where a hunk's lines stand: once, more than once, or nowhere. */
type Found =
  | { readonly kind: "once"; readonly at: number }
  | { readonly kind: "many"; readonly count: number }
  | { readonly kind: "none" };

function linesOf(content: string): FileLines {
  const bom = content.startsWith(byteOrderMark) ? byteOrderMark : "";
  // Each line keeps the break that ends it: the text splits just after each break.
  const raw = content
    .slice(bom.length)
    .split(/(?<=\r\n|\r(?!\n)|\n)/u)
    .filter((line) => line !== "");
  const lines = raw.map((line): FileLine => {
    const ending = /\r\n$|\r$|\n$/u.exec(line)?.[0] ?? "";
    return { text: line.slice(0, line.length - ending.length), ending };
  });
  return { bom, lines, ending: lines.find((line) => line.ending !== "")?.ending ?? "\n" };
}

function matchesAt(
  texts: readonly string[],
  at: number,
  wanted: { readonly pattern: readonly string[]; readonly same: (line: string) => string },
): boolean {
  const { pattern, same } = wanted;
  return pattern.every((line, index) => same(itemAt(texts, at + index, "")) === same(line));
}

// Where `pattern` stands from `from` on, by the strictest comparison that finds it; a hunk tied to
// the end is looked for at the end only.
function seek(
  texts: readonly string[],
  pattern: readonly string[],
  where: { readonly from: number; readonly atEnd: boolean },
): Found {
  const last = texts.length - pattern.length;
  const first = where.atEnd ? Math.max(where.from, last) : where.from;
  for (const same of comparisons) {
    const places: number[] = [];
    for (let at = first; at <= last; at += 1) {
      if (matchesAt(texts, at, { pattern, same })) {
        places.push(at);
      }
    }
    const [only, another] = places;
    if (only !== undefined) {
      return another === undefined
        ? { kind: "once", at: only }
        : { kind: "many", count: places.length };
    }
  }
  return { kind: "none" };
}

/** One hunk placed: from which line, how many lines it takes out, and the lines it puts in. */
interface Replacement {
  readonly start: number;
  readonly count: number;
  readonly lines: readonly FileLine[];
}

// New lines with the line breaks of the lines they replace, else the nearest one the file has.
function withEndings(
  file: FileLines,
  place: { readonly start: number; readonly count: number },
  texts: readonly string[],
): readonly FileLine[] {
  const replaced = file.lines.slice(place.start, place.start + place.count);
  const near =
    replaced.find((line) => line.ending !== "")?.ending ??
    file.lines[place.start]?.ending ??
    file.lines[place.start - 1]?.ending ??
    file.ending;
  const nearby = near === "" ? file.ending : near;
  return texts.map((text, index): FileLine => {
    const same = replaced.length === texts.length ? replaced[index] : undefined;
    const lastOfMany = index === texts.length - 1 ? replaced.at(-1) : undefined;
    const ending = (same ?? lastOfMany ?? replaced[index])?.ending ?? nearby;
    return { text, ending: ending === "" && index < texts.length - 1 ? nearby : ending };
  });
}

// The hunk's new lines, each context line kept as the file wrote it.
function hunkLines(file: FileLines, at: number, hunk: PatchHunk): readonly FileLine[] {
  const out: FileLine[] = [];
  let oldFrom = 0;
  let newFrom = 0;
  for (const [newAt, oldAt] of hunk.kept) {
    const place = { start: at + oldFrom, count: oldAt - oldFrom };
    out.push(...withEndings(file, place, hunk.newLines.slice(newFrom, newAt)));
    // The hunk matched here, so the file holds this line.
    out.push(itemAt(file.lines, at + oldAt, { text: "", ending: file.ending }));
    oldFrom = oldAt + 1;
    newFrom = newAt + 1;
  }
  const rest = { start: at + oldFrom, count: hunk.oldLines.length - oldFrom };
  return [...out, ...withEndings(file, rest, hunk.newLines.slice(newFrom))];
}

// Added lines with the file's line breaks; at the end of a file whose last line has none, the last
// added line has none either.
function addedLines(file: FileLines, at: number, texts: readonly string[]): readonly FileLine[] {
  const lines = withEndings(file, { start: at, count: 0 }, texts);
  const last = lines.at(-1);
  const bare = at === file.lines.length && file.lines.at(-1)?.ending === "";
  return bare && last !== undefined
    ? [...lines.slice(0, -1), { text: last.text, ending: "" }]
    : lines;
}

function quoted(hunk: PatchHunk): string {
  return hunk.oldLines.join("\n");
}

// The hunk with its last empty line let go, when only that keeps its lines out.
function shortened(hunk: PatchHunk): PatchHunk {
  const lastNew = hunk.newLines.at(-1) === "" ? hunk.newLines.slice(0, -1) : hunk.newLines;
  const oldLength = hunk.oldLines.length - 1;
  const kept = hunk.kept.filter(([newAt, oldAt]) => oldAt < oldLength && newAt < lastNew.length);
  return { ...hunk, oldLines: hunk.oldLines.slice(0, -1), newLines: lastNew, kept };
}

function placeChange(
  file: FileLines,
  hunk: PatchHunk,
  at: { readonly from: number; readonly named: string },
): Result<Replacement, string> {
  const texts = file.lines.map((line) => line.text);
  const where = { from: at.from, atEnd: hunk.atEnd };
  let used = hunk;
  let found = seek(texts, hunk.oldLines, where);
  if (found.kind === "none" && hunk.oldLines.at(-1) === "") {
    used = shortened(hunk);
    found = seek(texts, used.oldLines, where);
  }
  if (found.kind === "many") {
    return err(
      `${at.named}: these lines stand ${String(found.count)} times in the file; add lines around them so they stand once:\n${quoted(hunk)}`,
    );
  }
  if (found.kind === "none") {
    return err(
      `${at.named}: these lines are not in the file; read the file again:\n${quoted(hunk)}`,
    );
  }
  return ok({
    start: found.at,
    count: used.oldLines.length,
    lines: hunkLines(file, found.at, used),
  });
}

// Where a hunk's work starts: after its `@@` line, which must stand once from `from` on.
function anchorOf(
  file: FileLines,
  hunk: PatchHunk,
  at: { readonly from: number; readonly named: string },
): Result<number, string> {
  if (hunk.anchor === undefined) {
    return ok(at.from);
  }
  const found = seek(
    file.lines.map((line) => line.text),
    [hunk.anchor],
    { from: at.from, atEnd: false },
  );
  if (found.kind === "many") {
    return err(
      `${at.named}: the line after @@ stands ${String(found.count)} times in the file; name a line that stands once`,
    );
  }
  return found.kind === "once"
    ? ok(found.at + 1)
    : err(`${at.named}: the line after @@ is not in the file`);
}

function placeAll(
  file: FileLines,
  hunks: readonly PatchHunk[],
  path: string,
): Result<readonly Replacement[], string> {
  const placed: Replacement[] = [];
  let from = 0;
  for (const [index, hunk] of hunks.entries()) {
    const named = `change ${String(index + 1)} of ${path}`;
    const start = anchorOf(file, hunk, { from, named });
    if (!start.ok) {
      return start;
    }
    if (hunk.oldLines.length === 0) {
      // Lines that replace none go right after the `@@` line, or at the end without one.
      const at = hunk.anchor !== undefined && !hunk.atEnd ? start.value : file.lines.length;
      placed.push({ start: at, count: 0, lines: addedLines(file, at, hunk.newLines) });
      from = at;
      continue;
    }
    const replacement = placeChange(file, hunk, { from: start.value, named });
    if (!replacement.ok) {
      return replacement;
    }
    placed.push(replacement.value);
    from = replacement.value.start + replacement.value.count;
  }
  return ok(placed.toSorted((a, b) => a.start - b.start));
}

/**
 * A file's text with a patch's hunks made, in order, each found after the one before (decision
 * 0386): exactly, else ignoring trailing spaces, then all outer spaces, then reading curly quotes,
 * dashes and special spaces as plain ones. The first way that finds a hunk's lines decides, and
 * lines found more than once there are refused, as is a `@@` line that stands more than once. A
 * hunk of added lines only goes right after its `@@` line, else at the end. The lines a hunk keeps
 * stay as the file wrote them; each line keeps its own line break, and a last line without one
 * stays so. A hunk that cannot be placed answers why, quoting its lines.
 */
export function applyHunks(
  content: string,
  hunks: readonly PatchHunk[],
  path: string,
): Result<string, string> {
  const file = linesOf(content);
  const placed = placeAll(file, hunks, path);
  if (!placed.ok) {
    return placed;
  }
  const next: FileLine[] = [...file.lines];
  for (const each of placed.value.toReversed()) {
    next.splice(each.start, each.count, ...each.lines);
  }
  // A line that moved inward from the end needs the line break it lacked.
  const text = next
    .map(
      (line, index) =>
        line.text + (line.ending === "" && index < next.length - 1 ? file.ending : line.ending),
    )
    .join("");
  return ok(file.bom + text);
}
