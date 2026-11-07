import { err, ok, type Result } from "@binference/core";
import { fileLimits, type ResultOf } from "@binference/protocol";

type TextPage = Extract<ResultOf<"file/read">, { readonly kind: "text" }>;

/** Where a page starts and how many lines it may hold. */
export interface PageRequest {
  readonly offset?: number;
  readonly limit?: number;
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

/**
 * One page of a text file from line `offset` (1-based, 1 when absent): at most `limit` lines and
 * 2,000, and at most 10 KiB of text; a first line longer than that is cut. The page names where
 * the next one starts. An offset past the last line is `file.offset_past_end`.
 */
export function readPage(
  file: { readonly path: string; readonly text: string },
  request: PageRequest,
): Result<TextPage, "file.offset_past_end"> {
  const lines = linesOf(file.text);
  const start = request.offset ?? 1;
  if (start > Math.max(lines.length, 1)) {
    return err("file.offset_past_end");
  }
  const most = Math.min(request.limit ?? fileLimits.maxFileReadLines, fileLimits.maxFileReadLines);
  const wanted = lines.slice(start - 1, start - 1 + most);
  const { kept, cutByBytes } = keptLines(wanted);
  const endLine = start - 1 + kept.length;
  const page: TextPage = {
    kind: "text",
    path: file.path,
    text: kept.join("\n"),
    startLine: start,
    endLine,
    totalLines: lines.length,
  };
  const wantedEnd = start - 1 + wanted.length;
  if (cutByBytes) {
    return ok({ ...page, next: { offset: endLine + 1, cutBy: "bytes" } });
  }
  return wantedEnd < lines.length
    ? ok({ ...page, next: { offset: endLine + 1, cutBy: "lines" } })
    : ok(page);
}
