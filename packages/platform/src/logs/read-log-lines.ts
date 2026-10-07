import { Buffer } from "node:buffer";
import { open } from "node:fs/promises";
import { BinferenceError, err, ok, type Result } from "@binference/core";

/** What to read from a log file. */
export interface ReadLogLinesOptions {
  /**
   * The byte to start at: the `next` of the last read. Left out, the read takes the file's last
   * `maxBytes`. A file now shorter than `from` was set aside and started again, so the read starts
   * at its beginning.
   */
  readonly from?: number;
  /** The most bytes one read takes. */
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}

/** The whole lines one read found. */
export interface LogLines {
  /** Each whole line, without its newline. A line cut by the read's start or end is left out. */
  readonly lines: readonly string[];
  /** Where the next read starts: the byte after the last whole line. */
  readonly next: number;
}

const newline = 0x0a;

function isMissing(error: Error): boolean {
  return "code" in error && error.code === "ENOENT";
}

function startOf(size: number, options: ReadLogLinesOptions): number {
  if (options.from === undefined) {
    return Math.max(0, size - options.maxBytes);
  }
  return options.from > size ? 0 : options.from;
}

/** Where a read's bytes start in the file, and whether the read is a tail. */
interface ReadWindow {
  readonly readFrom: number;
  readonly isTail: boolean;
}

function wholeLines(bytes: Buffer, window: ReadWindow): LogLines {
  const { readFrom, isTail } = window;
  const last = bytes.lastIndexOf(newline);
  if (last === -1) {
    // A tail with no newline sits inside one line longer than the read: skip past it.
    return { lines: [], next: isTail ? readFrom + bytes.length : readFrom };
  }
  // A tail reads from the byte before its start, so a line that starts there is kept whole.
  const first = isTail ? bytes.indexOf(newline) + 1 : 0;
  const next = readFrom + last + 1;
  if (last < first) {
    return { lines: [], next };
  }
  const text = bytes.subarray(first, last).toString("utf8");
  return { lines: text.split("\n").map((line) => line.replace(/\r$/, "")), next };
}

async function readRange(path: string, options: ReadLogLinesOptions): Promise<LogLines> {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    // Windows opens a folder for reading and reports it empty; only a regular file is a log.
    if (!info.isFile()) {
      throw new Error(`${path} is not a file.`);
    }
    const { size } = info;
    const start = startOf(size, options);
    const isTail = options.from === undefined && start > 0;
    const readFrom = isTail ? start - 1 : start;
    const length = Math.min(options.maxBytes + (isTail ? 1 : 0), size - readFrom);
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await handle.read(bytes, 0, length, readFrom);
    return wholeLines(bytes.subarray(0, bytesRead), { readFrom, isTail });
  } finally {
    await handle.close();
  }
}

/**
 * Reads whole lines from a log file, for `binference logs` and its follow mode. Returns
 * `not_found` when the file does not exist yet; throws `platform.file_read_failed` when it cannot
 * be read.
 */
export async function readLogLines(
  path: string,
  options: ReadLogLinesOptions,
): Promise<Result<LogLines, "not_found">> {
  options.signal.throwIfAborted();
  try {
    return ok(await readRange(path, options));
  } catch (error) {
    if (error instanceof Error && isMissing(error)) {
      return err("not_found");
    }
    throw new BinferenceError({
      code: "platform.file_read_failed",
      message: `Could not read ${path}; check that it is a file you can read.`,
      cause: error,
      details: { path },
    });
  }
}
