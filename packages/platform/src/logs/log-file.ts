import { Buffer } from "node:buffer";
import { appendFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { BinferenceError, type Clock } from "@binference/core";

/** Where a log file lives, when it is set aside, and how long set-aside files stay. */
export interface LogFileOptions {
  /** The file lines go to, such as `logs/engine.log`. Its folder must exist and be owner-only. */
  readonly file: string;
  /** Once the file would pass this many bytes it is set aside and a new one starts. */
  readonly maxBytes: number;
  /** Set-aside files older than this are removed when a file is set aside or first written. */
  readonly keepMs: number;
  readonly clock: Clock;
  /** The most lines waiting to be written; past it the oldest is dropped. 4,096 by default. */
  readonly maxQueuedLines?: number;
  /** Hears a write or a set-aside that failed. The lines of a failed write are lost. */
  readonly onError?: (error: BinferenceError) => void;
}

/**
 * A log file that never blocks its writer: lines queue in memory and one writer appends them in
 * order. Set-aside files are named `<name>.<epoch ms>.log` beside the file.
 */
export interface LogFile {
  /** Queues one line; a newline is added. Never throws and never waits; ignored once closed. */
  append(line: string): void;
  /** Resolves once every line queued so far is written or has failed. */
  flush(): Promise<void>;
  /** Writes what is queued, then refuses new lines. */
  close(): Promise<void>;
}

const defaultMaxQueuedLines = 4_096;

type LogFailure = "platform.log_set_aside_failed" | "platform.log_write_failed";

function failure(code: LogFailure, path: string, cause: ErrorOptions["cause"]): BinferenceError {
  return new BinferenceError({
    code,
    message: `The log file ${path} could not be written; check its folder and the disk.`,
    cause,
    details: { path },
  });
}

// The size of the log file, 0 when there is none yet, or `undefined` when something other than a
// file holds its path. A folder's size differs by OS (4 KiB on Linux), so it is never measured.
async function sizeOf(path: string): Promise<number | undefined> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : undefined;
  } catch {
    return 0;
  }
}

function setAsidePattern(file: string): RegExp {
  const stem = basename(file, extname(file)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${stem}\\.(\\d+)\\.log$`);
}

/** Removes the set-aside files of `file` older than `keepMs`; a file it cannot remove stays. */
async function removeOld(options: LogFileOptions): Promise<void> {
  const pattern = setAsidePattern(options.file);
  const folder = dirname(options.file);
  const oldest = options.clock.now() - options.keepMs;
  const names = await readdir(folder);
  const old = names.filter((name) => Number(pattern.exec(name)?.[1] ?? oldest) < oldest);
  await Promise.all(old.map(async (name) => rm(join(folder, name), { force: true })));
}

async function setAside(options: LogFileOptions): Promise<void> {
  const stem = basename(options.file, extname(options.file));
  const target = join(dirname(options.file), `${stem}.${String(options.clock.now())}.log`);
  await rename(options.file, target);
  await removeOld(options);
}

// Sets the full file aside and answers the new size, or keeps writing to it when it cannot.
async function makeRoom(options: LogFileOptions, size: number): Promise<number> {
  try {
    await setAside(options);
    return 0;
  } catch (error) {
    options.onError?.(failure("platform.log_set_aside_failed", options.file, error));
    return size;
  }
}

/**
 * Appends one batch of lines and answers the file's size after it, or `undefined` when something
 * other than a file holds the path, so the next batch looks again.
 */
async function writeBatch(
  options: LogFileOptions,
  batch: string,
  knownSize: number | undefined,
): Promise<number | undefined> {
  const bytes = Buffer.byteLength(batch);
  const size = knownSize ?? (await sizeOf(options.file));
  if (size === undefined) {
    // Never set aside or write over what holds the path: the owner put it there.
    const notFile = new Error(`${options.file} is not a file.`);
    options.onError?.(failure("platform.log_write_failed", options.file, notFile));
    return undefined;
  }
  if (size === 0) {
    await removeOld(options).catch(() => undefined);
  }
  const room = size > 0 && size + bytes > options.maxBytes ? await makeRoom(options, size) : size;
  try {
    await appendFile(options.file, batch, { encoding: "utf8", mode: 0o600 });
    return room + bytes;
  } catch (error) {
    options.onError?.(failure("platform.log_write_failed", options.file, error));
    return room;
  }
}

/**
 * Opens a log file for appending. Nothing touches the disk until the first line. Each write
 * appends a batch of lines; a file that would pass `maxBytes` is set aside first, and set-aside
 * files older than `keepMs` are removed. A failed write loses its lines and is reported through
 * `onError`; logging never throws.
 */
export function openLogFile(options: LogFileOptions): LogFile {
  const queue: string[] = [];
  const maxQueued = options.maxQueuedLines ?? defaultMaxQueuedLines;
  let draining: Promise<void> | undefined;
  let size: number | undefined;
  let isClosed = false;
  // One writer: each batch takes every line queued while the one before it was written.
  const drain = async (): Promise<void> => {
    if (queue.length > 0) {
      size = await writeBatch(options, queue.splice(0).join(""), size);
      await drain();
    }
  };
  const startDrain = (): void => {
    if (draining === undefined && queue.length > 0) {
      draining = drain().finally(() => {
        draining = undefined;
        startDrain();
      });
    }
  };
  const flush = async (): Promise<void> => {
    if (draining !== undefined) {
      await draining;
      await flush();
    }
  };
  return {
    append(line) {
      if (isClosed) {
        return;
      }
      queue.push(`${line}\n`);
      if (queue.length > maxQueued) {
        queue.shift();
      }
      startDrain();
    },
    flush,
    async close() {
      isClosed = true;
      await flush();
    },
  };
}
