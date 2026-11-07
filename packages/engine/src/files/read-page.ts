import { fileLimits, type ResultOf } from "@binference/protocol";
import { itemAt } from "./item-at.js";

type TextPage = Extract<ResultOf<"file/read">, { readonly kind: "text" }>;

/** Where a page starts and how many lines it may hold. */
export interface PageRequest {
  readonly offset?: number;
  readonly limit?: number;
  readonly cursor?: number;
}

const encoder = new TextEncoder();

// The file's lines as the reader sees them: a line break ends a line, a carriage return before it
// is dropped, and a last line break opens no line of its own.
function linesOf(text: string): readonly string[] {
  if (text === "") {
    return [];
  }
  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  return text.endsWith("\n") ? lines.slice(0, -1) : lines;
}

// The longest start of `line` within `bytes` bytes of UTF-8, never splitting a character.
function cutTo(line: string, bytes: number): string {
  let kept = "";
  let used = 0;
  for (const character of line) {
    used += encoder.encode(character).byteLength;
    if (used > bytes) {
      break;
    }
    kept += character;
  }
  return kept;
}

// The lines that fit in 10 KiB, a first line longer than that cut, and whether bytes cut them.
function keptLines(wanted: readonly string[]): {
  readonly kept: readonly string[];
  readonly cutByBytes: boolean;
} {
  const kept: string[] = [];
  let used = 0;
  for (const line of wanted) {
    const size = encoder.encode(line).byteLength + (kept.length === 0 ? 0 : 1);
    if (used + size > fileLimits.maxFileReadBytes) {
      return {
        kept: kept.length === 0 ? [cutTo(line, fileLimits.maxFileReadBytes)] : kept,
        cutByBytes: true,
      };
    }
    kept.push(line);
    used += size;
  }
  return { kept, cutByBytes: false };
}

// Where the next page starts: inside the first line when only part of it fit, else at the line
// after the last one kept, when the file holds more.
function nextOf(page: {
  readonly start: number;
  readonly cursor: number;
  readonly kept: readonly string[];
  readonly inLine: readonly string[];
  readonly cutByBytes: boolean;
  readonly more: boolean;
}): NonNullable<TextPage["next"]> | undefined {
  const [firstKept, secondKept] = page.kept;
  const isOneCut =
    firstKept !== undefined &&
    secondKept === undefined &&
    firstKept.length < itemAt(page.inLine, 0, "").length;
  if (isOneCut) {
    // A line longer than a page goes on inside itself, never skipped.
    return { offset: page.start, cursor: page.cursor + firstKept.length, cutBy: "bytes" };
  }
  const offset = page.start + page.kept.length;
  if (page.cutByBytes) {
    return { offset, cutBy: "bytes" };
  }
  return page.more ? { offset, cutBy: "lines" } : undefined;
}

// Where to start inside a line: never past its end, and never between the two halves of one
// character.
function cursorIn(line: string, cursor: number): number {
  const at = Math.min(cursor, line.length);
  const before = line.charCodeAt(at - 1);
  return at > 0 && before >= 0xd800 && before <= 0xdbff ? at - 1 : at;
}

/**
 * One page of a text file from line `offset` (1-based, 1 when absent): at most `limit` lines and
 * 2,000, and at most 10 KiB of text, from character `cursor` of the first line. A first line longer
 * than that is cut, and the page names the cursor to go on inside it; else it names the line the
 * next page starts at. An offset past the last line gives no text, with the file's line count.
 */
export function readPage(
  file: { readonly path: string; readonly text: string },
  request: PageRequest,
): TextPage {
  const lines = linesOf(file.text);
  const start = request.offset ?? 1;
  if (start > Math.max(lines.length, 1)) {
    // Past the last line: no text, and how many lines the file holds.
    const total = lines.length;
    return {
      kind: "text",
      path: file.path,
      text: "",
      startLine: start,
      endLine: total,
      totalLines: total,
    };
  }
  const most = Math.min(request.limit ?? fileLimits.maxFileReadLines, fileLimits.maxFileReadLines);
  const cursor = cursorIn(lines[start - 1] ?? "", request.cursor ?? 0);
  const wanted = lines.slice(start - 1, start - 1 + most);
  const inLine = wanted.map((line, index) => (index === 0 ? line.slice(cursor) : line));
  const { kept, cutByBytes } = keptLines(inLine);
  const endLine = start - 1 + kept.length;
  const page: TextPage = {
    kind: "text",
    path: file.path,
    text: kept.join("\n"),
    startLine: start,
    endLine,
    totalLines: lines.length,
  };
  const next = nextOf({
    start,
    cursor,
    kept,
    inLine,
    cutByBytes,
    more: start - 1 + wanted.length < lines.length,
  });
  return next === undefined ? page : { ...page, next };
}
