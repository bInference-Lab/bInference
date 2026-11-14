import type { JsonValue } from "@binference/core";
import { readLogLines } from "@binference/platform";
import { reportLogLine } from "./report-log-line.js";

/** The newest lines of a log file, kept by the field rules of {@link reportLogLine}. */
export interface RecentLogLines {
  /** Whether the file was there to read. */
  readonly isRead: boolean;
  /** The lines that have the log's JSON shape, oldest first. */
  readonly lines: readonly { readonly [key: string]: JsonValue }[];
  /** How many of the lines read were left out, since they lack the log's JSON shape. */
  readonly omitted: number;
}

/** How much a read takes: at most `maxBytes` from the end of the file, then its last lines. */
export interface RecentLogBounds {
  readonly maxBytes: number;
  readonly maxLines: number;
  readonly signal: AbortSignal;
}

/**
 * Reads the newest lines of the log file at `file` and keeps each that has the log's JSON shape by
 * the field rules of {@link reportLogLine} (decision 0263), counting every other line it read. A
 * file that is not there reads as no line.
 */
export async function readRecentLogLines(
  file: string,
  bounds: RecentLogBounds,
): Promise<RecentLogLines> {
  const tail = await readLogLines(file, { maxBytes: bounds.maxBytes, signal: bounds.signal });
  const read = tail.ok ? tail.value.lines.slice(-bounds.maxLines) : [];
  const lines = read.flatMap((text) => {
    const line = reportLogLine(text);
    return line === undefined ? [] : [line];
  });
  return { isRead: tail.ok, lines, omitted: read.length - lines.length };
}
