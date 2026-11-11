import type { SkillDiffLine } from "@binference/protocol";

/** The most diff lines a proposal shows; past it the diff is cut and says so. */
const maxDiffLines = 400;
/** The largest table of line pairs worked out; past it every old line goes and every new one comes. */
const maxPairs = 4_000_000;

/** A diff of two texts by line, cut to its first lines. */
export interface LineDiff {
  readonly lines: readonly SkillDiffLine[];
  readonly cut: boolean;
}

function linesOf(text: string): readonly string[] {
  if (text === "") {
    return [];
  }
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

// The length of the longest common run of lines from each pair of places on, row by row.
function commonLengths(before: readonly string[], after: readonly string[]): Uint32Array {
  const width = after.length + 1;
  const table = new Uint32Array((before.length + 1) * width);
  for (let row = before.length - 1; row >= 0; row -= 1) {
    for (let column = after.length - 1; column >= 0; column -= 1) {
      const here = row * width + column;
      table[here] =
        before[row] === after[column]
          ? (table[here + width + 1] ?? 0) + 1
          : Math.max(table[here + width] ?? 0, table[here + 1] ?? 0);
    }
  }
  return table;
}

/** Where the walk through both texts stands. */
interface Place {
  readonly row: number;
  readonly column: number;
}

// The next line of the diff from a place: the same line on both sides, else the side whose step
// keeps the longer common run after it, the old line's removal first on a tie.
function stepAt(
  sides: { readonly before: readonly string[]; readonly after: readonly string[] },
  table: Uint32Array,
  { row, column }: Place,
): SkillDiffLine["kind"] {
  const old = sides.before[row];
  const now = sides.after[column];
  if (old !== undefined && old === now) {
    return "same";
  }
  if (now === undefined) {
    return "remove";
  }
  const width = sides.after.length + 1;
  const afterAdd = table[row * width + column + 1] ?? 0;
  const afterRemove = table[(row + 1) * width + column] ?? 0;
  return old === undefined || afterAdd > afterRemove ? "add" : "remove";
}

function walked(before: readonly string[], after: readonly string[]): readonly SkillDiffLine[] {
  const table = commonLengths(before, after);
  const lines: SkillDiffLine[] = [];
  let place: Place = { row: 0, column: 0 };
  while (place.row < before.length || place.column < after.length) {
    const kind = stepAt({ before, after }, table, place);
    const text = (kind === "add" ? after[place.column] : before[place.row]) ?? "";
    lines.push({ kind, text });
    place = {
      row: place.row + (kind === "add" ? 0 : 1),
      column: place.column + (kind === "remove" ? 0 : 1),
    };
  }
  return lines;
}

/**
 * The diff of a skill's text before and after a proposal, line by line by their longest common
 * run: each line kept, added or removed, line endings read as `\n`. Texts too long to compare line
 * by line show every old line removed and every new one added. At most 400 lines are given.
 */
export function lineDiff(before: string, after: string): LineDiff {
  const old = linesOf(before);
  const now = linesOf(after);
  const all =
    (old.length + 1) * (now.length + 1) > maxPairs
      ? [
          ...old.map((text): SkillDiffLine => ({ kind: "remove", text })),
          ...now.map((text): SkillDiffLine => ({ kind: "add", text })),
        ]
      : walked(old, now);
  return { lines: all.slice(0, maxDiffLines), cut: all.length > maxDiffLines };
}
