import type { ArgsOf } from "@binference/protocol";
import { byteOrderMark } from "./byte-order-mark.js";
import { itemAt } from "./item-at.js";
import { foldCharacter } from "./loose-characters.js";

type FileEdit = ArgsOf<"file/edit">["edits"][number];

/**
 * Why the edits could not be placed: which edit, and whether its text stands nowhere, stands
 * `count` times, or overlaps the edit `other`.
 */
export type EditProblem =
  | { readonly kind: "no_match"; readonly index: number }
  | { readonly kind: "many_matches"; readonly index: number; readonly count: number }
  | { readonly kind: "overlap"; readonly index: number; readonly other: number };

/** The file's new text, how many replacements changed it, and whether anything changed. */
interface EditPlan {
  readonly text: string;
  readonly replaced: number;
  readonly changed: boolean;
}

/** What planning the edits gives: the plan, or the problem that stopped it. */
export type EditOutcome =
  | { readonly kind: "planned"; readonly plan: EditPlan }
  | { readonly kind: "refused"; readonly problem: EditProblem };

/** Text as a match reads it, and where each of its characters stood in the text it came from. */
interface Mapped {
  readonly text: string;
  readonly places: readonly number[];
}

// The text with every line break read as `\n`, each character keeping its place in the original.
function lfOf(text: string): Mapped {
  let out = "";
  const places: number[] = [];
  let at = 0;
  while (at < text.length) {
    // A `\r\n` reads as one `\n` at the place its `\r` stands, so a span never splits it.
    const step = text.startsWith("\r\n", at) ? 2 : 1;
    out += step === 2 ? "\n" : text.charAt(at);
    places.push(at);
    at += step;
  }
  places.push(text.length);
  return { text: out, places };
}

// Text as a loose match reads it: each line without its trailing spaces, in Unicode's compatible
// form, curly quotes as straight ones, every dash as a hyphen and every special space as a plain
// space. Each character keeps the place it stood at, so a match maps back to the original's span.
function looseOf(text: string): Mapped {
  let loose = "";
  const places: number[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    const kept = line.trimEnd();
    for (let index = 0; index < kept.length; index += 1) {
      const read = foldCharacter(kept.charAt(index).normalize("NFKC"));
      loose += read;
      places.push(...Array.from({ length: read.length }, () => at + index));
    }
    loose += "\n";
    places.push(at + line.length);
    at += line.length + 1;
  }
  return { text: loose.slice(0, -1), places: places.slice(0, -1) };
}

/** Where one edit's text stands in the `\n` text, and what replaces it. */
interface Placed {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly newText: string;
}

/** A span of text, from its first character to the one after its last. */
interface Span {
  readonly start: number;
  readonly end: number;
}

function countOf(text: string, part: string): number {
  return part === "" ? 0 : text.split(part).length - 1;
}

// The span of `oldText`: exact first, then loose, and unique either way.
function place(
  text: string,
  oldText: string,
  loose: () => Mapped,
): Span | { readonly count: number } {
  const exact = countOf(text, oldText);
  if (exact > 1) {
    return { count: exact };
  }
  if (exact === 1) {
    const start = text.indexOf(oldText);
    return { start, end: start + oldText.length };
  }
  const file = loose();
  const wanted = looseOf(oldText).text;
  const found = countOf(file.text, wanted);
  const at = file.text.indexOf(wanted);
  const first = file.places[at];
  const last = file.places[at + wanted.length - 1];
  if (found !== 1 || first === undefined || last === undefined) {
    return { count: found };
  }
  return { start: first, end: last + 1 };
}

function placeAll(text: string, edits: readonly FileEdit[]): readonly Placed[] | EditProblem {
  let loose: Mapped | undefined;
  const placed: Placed[] = [];
  for (const [index, edit] of edits.entries()) {
    const span = place(text, edit.oldText, () => (loose ??= looseOf(text)));
    if ("count" in span) {
      const { count } = span;
      return count > 1 ? { kind: "many_matches", index, count } : { kind: "no_match", index };
    }
    placed.push({ index, ...span, newText: edit.newText });
  }
  const sorted = placed.toSorted((a, b) => a.start - b.start);
  for (const [at, after] of sorted.entries()) {
    const before = sorted[at - 1];
    if (before !== undefined && before.end > after.start) {
      return { kind: "overlap", index: before.index, other: after.index };
    }
  }
  return sorted;
}

const lf = (text: string): string => text.replaceAll("\r\n", "\n");

// The line break a replacement writes: the one inside the text it replaces, else the file's first.
function endingFor(original: string, span: Span, fileEnding: string): string {
  const inside = /\r?\n/u.exec(original.slice(span.start, span.end));
  return inside?.[0] ?? fileEnding;
}

/**
 * The file's text with every edit made against it as it is now (decision 0386): each `oldText`
 * found exactly, else by a loose match that ignores trailing spaces and reads compatible
 * characters, curly quotes, dashes and special spaces as plain ones; either way unique, and apart
 * from the others. A problem names the edit, how often its text stands, or the edit it overlaps. A
 * replacement always goes into the original's own span; every line keeps its own line break and
 * a replacement's lines take the break of the text they replace. A byte order mark stays. An
 * empty `oldText` matches nothing.
 */
export function planEdits(content: string, edits: readonly FileEdit[]): EditOutcome {
  const bom = content.startsWith(byteOrderMark) ? byteOrderMark : "";
  const original = content.slice(bom.length);
  const mapped = lfOf(original);
  const fileEnding = original.includes("\r\n") ? "\r\n" : "\n";
  const lfEdits = edits.map((edit) => ({ oldText: lf(edit.oldText), newText: lf(edit.newText) }));
  const placed = placeAll(mapped.text, lfEdits);
  if ("kind" in placed) {
    return { kind: "refused", problem: placed };
  }
  let next = "";
  let from = 0;
  let replaced = 0;
  for (const each of placed) {
    const start = itemAt(mapped.places, each.start, 0);
    const span = { start, end: itemAt(mapped.places, each.end, original.length) };
    const written = each.newText.replaceAll("\n", endingFor(original, span, fileEnding));
    replaced += original.slice(span.start, span.end) === written ? 0 : 1;
    next += original.slice(from, span.start) + written;
    from = span.end;
  }
  next += original.slice(from);
  return { kind: "planned", plan: { text: bom + next, replaced, changed: next !== original } };
}
