import { err, ok, type Result } from "@binference/core";
import type { ArgsOf } from "@binference/protocol";
import { foldCharacter } from "./loose-characters.js";

type FileEdit = ArgsOf<"file/edit">["edits"][number];

/** Why the edits could not be placed in the file's text. */
export type EditProblem = "file.no_match" | "file.many_matches" | "file.overlap";

/** The file's new text, how many replacements changed it, and whether anything changed. */
export interface EditPlan {
  readonly text: string;
  readonly replaced: number;
  readonly changed: boolean;
}

// Text as a loose match reads it: each line without its trailing spaces, curly quotes as straight
// ones, every dash as a hyphen, and every special space as a plain space. Each kept character
// remembers where it stood in the original, so a match maps back to the original's own span.
interface LooseText {
  readonly text: string;
  readonly places: readonly number[];
}

function looseOf(text: string): LooseText {
  let loose = "";
  const places: number[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    const kept = line.trimEnd();
    for (let index = 0; index < kept.length; index += 1) {
      const character = kept.charAt(index);
      loose += foldCharacter(character);
      places.push(at + index);
    }
    loose += "\n";
    places.push(at + line.length);
    at += line.length + 1;
  }
  return { text: loose.slice(0, -1), places: places.slice(0, -1) };
}

/** Where one edit's text stands in the original, and what replaces it. */
interface Placed {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly newText: string;
}

function countOf(text: string, part: string): number {
  return part === "" ? 0 : text.split(part).length - 1;
}

// The span of `oldText` in the original: exact first, then loose, and unique either way.
function place(
  text: string,
  oldText: string,
  loose: () => LooseText,
): Result<{ readonly start: number; readonly end: number }, EditProblem> {
  const exact = countOf(text, oldText);
  if (exact > 1) {
    return err("file.many_matches");
  }
  if (exact === 1) {
    const start = text.indexOf(oldText);
    return ok({ start, end: start + oldText.length });
  }
  const file = loose();
  const wanted = looseOf(oldText).text;
  const found = countOf(file.text, wanted);
  if (found > 1) {
    return err("file.many_matches");
  }
  const at = file.text.indexOf(wanted);
  const first = file.places[at];
  const last = file.places[at + wanted.length - 1];
  if (found === 0 || first === undefined || last === undefined) {
    return err("file.no_match");
  }
  return ok({ start: first, end: last + 1 });
}

function placeAll(
  text: string,
  edits: readonly FileEdit[],
): Result<readonly Placed[], EditProblem> {
  let loose: LooseText | undefined;
  const placed: Placed[] = [];
  for (const [index, edit] of edits.entries()) {
    const span = place(text, edit.oldText, () => (loose ??= looseOf(text)));
    if (!span.ok) {
      return span;
    }
    placed.push({ index, ...span.value, newText: edit.newText });
  }
  const sorted = placed.toSorted((a, b) => a.start - b.start);
  const overlapping = sorted.some((each, at) => at > 0 && (sorted[at - 1]?.end ?? 0) > each.start);
  return overlapping ? err("file.overlap") : ok(sorted);
}

const lf = (text: string): string => text.replaceAll("\r\n", "\n");

/**
 * The file's text with every edit made against it as it is now (decision 0386): each `oldText`
 * found exactly, else by a loose match that ignores trailing spaces and reads curly quotes, dashes
 * and special spaces as plain ones; either way unique, or `file.many_matches`, found, or
 * `file.no_match`, and apart from the others, or `file.overlap`. A replacement always goes into
 * the original's own span. Line breaks are read as `\n` and written back as the file had them,
 * and a byte order mark stays. An empty `oldText` matches nothing.
 */
export function planEdits(
  content: string,
  edits: readonly FileEdit[],
): Result<EditPlan, EditProblem> {
  const bom = content.startsWith("﻿") ? "﻿" : "";
  const crlf = content.includes("\r\n");
  const text = lf(content.slice(bom.length));
  const lfEdits = edits.map((edit) => ({ oldText: lf(edit.oldText), newText: lf(edit.newText) }));
  const placed = placeAll(text, lfEdits);
  if (!placed.ok) {
    return placed;
  }
  let next = "";
  let from = 0;
  for (const each of placed.value) {
    next += text.slice(from, each.start) + each.newText;
    from = each.end;
  }
  next += text.slice(from);
  const written = bom + (crlf ? next.replaceAll("\n", "\r\n") : next);
  const replaced = placed.value.filter((each) => text.slice(each.start, each.end) !== each.newText);
  return ok({ text: written, replaced: replaced.length, changed: next !== text });
}
