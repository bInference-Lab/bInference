import { ok } from "@binference/core";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import {
  type LogLineView,
  logLevels,
  logLineViewSchema,
  maxRecentLogLines,
} from "@binference/protocol";
import { readRecentLogLines } from "../logging/recent-log-lines.js";

/** Where `log/recent` reads: the engine's log file. */
export interface LogOperationsOptions {
  readonly file: string;
}

// The newest part of the log a call reads, the lines it answers when it names none, and the most
// bytes of lines an answer holds (decision 0446).
const tailBytes = 1024 * 1024;
const defaultLines = 200;
const maxAnswerBytes = 512 * 1024;

const encoder = new TextEncoder();

// The newest lines whose JSON fits the answer's bytes, and whether older ones were cut for it.
function newestWithin(lines: readonly LogLineView[]): {
  readonly items: readonly LogLineView[];
  readonly isCut: boolean;
} {
  let bytes = 2;
  let first = lines.length;
  while (first > 0) {
    const line = lines[first - 1];
    const size = line === undefined ? 0 : encoder.encode(JSON.stringify(line)).byteLength + 1;
    if (bytes + size > maxAnswerBytes) {
      break;
    }
    bytes += size;
    first -= 1;
  }
  return { items: lines.slice(first), isCut: first > 0 };
}

/**
 * The handler of `log/recent` (decision 0446): the newest lines of the engine's log file, read
 * from its last 1 MiB and at most 500 lines of it, each kept by the support bundle's field rules
 * (decision 0263) so a request's host is always `[omitted]`, and every line without the log's JSON
 * shape counted in `omitted`. It keeps the lines at the level asked or above, then the newest
 * `limit` (200 when absent), oldest first, then cuts the oldest until they fit 512 KiB, with
 * `cut: true`. A file the engine has not written answers no line.
 */
export function createLogOperations(options: LogOperationsOptions): EngineHandlerTable {
  return {
    "log/recent": async ({ args, signal }) => {
      const bounds = { maxBytes: tailBytes, maxLines: maxRecentLogLines, signal };
      const recent = await readRecentLogLines(options.file, bounds);
      const lowest = logLevels.indexOf(args.level ?? "debug");
      const views = recent.lines.flatMap((line) => {
        const parsed = logLineViewSchema.safeParse(line);
        return parsed.success ? [parsed.data] : [];
      });
      const kept = views
        .filter(({ level }) => logLevels.indexOf(level) >= lowest)
        .slice(-(args.limit ?? defaultLines));
      const { items, isCut } = newestWithin(kept);
      // A kept line the view does not read is left out and counted too.
      const omitted = recent.omitted + recent.lines.length - views.length;
      return ok({ items, omitted, ...(isCut ? { cut: true as const } : {}) });
    },
  };
}
