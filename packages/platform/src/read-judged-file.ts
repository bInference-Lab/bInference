import type { BigIntStats } from "node:fs";
import { type FileHandle, open, stat } from "node:fs/promises";
import { readOpenFlags, realPathOf } from "./read-file-bytes.js";

/** Why a judged read read nothing, apart from the caller's own refusal. */
export type JudgedReadFault = "not_found" | "changed" | "is_folder" | "too_large" | "unreadable";

/**
 * What {@link readJudgedFile} answers: the bytes with the real path they were read at, the
 * caller's refusal of that real path, or why nothing was read.
 */
export type JudgedFileRead<R> =
  | { readonly kind: "read"; readonly realPath: string; readonly bytes: Uint8Array }
  | { readonly kind: "refused"; readonly refusal: R }
  | { readonly kind: JudgedReadFault };

/** How a path's real path is found: every link resolved, or `undefined` when nothing is there. */
export type RealPathStep = (path: string, signal: AbortSignal) => Promise<string | undefined>;

/** What a judged read takes besides its path. */
export interface JudgedReadOptions<R> {
  readonly maxBytes: number;
  readonly signal: AbortSignal;
  /** Judges the real path of the file opened: `undefined` accepts it, any value refuses. */
  readonly judge: (realPath: string) => R | undefined;
  /** The platform's {@link realPathOf} unless a test passes its own. */
  readonly realPath?: RealPathStep;
}

function codeOf(error: Error): string | undefined {
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function faultOfOpen(error: Error): JudgedReadFault {
  const code = codeOf(error);
  if (code === "ENOENT") {
    return "not_found";
  }
  return code === "EISDIR" ? "is_folder" : "unreadable";
}

async function statOf(path: string): Promise<BigIntStats | undefined> {
  try {
    return await stat(path, { bigint: true });
  } catch {
    return undefined;
  }
}

// The open file is the one at the real path only when both name one device and one file on it.
function isSameFile(held: BigIntStats, there: BigIntStats | undefined): boolean {
  return there !== undefined && held.dev === there.dev && held.ino === there.ino;
}

async function readHeld<R>(
  handle: FileHandle,
  path: string,
  options: JudgedReadOptions<R>,
): Promise<JudgedFileRead<R>> {
  const { signal } = options;
  const held = await handle.stat({ bigint: true });
  // The path is resolved after the open: what it names now must be the file the handle holds,
  // else a link could have moved between the judgment and the read.
  const realPath = await (options.realPath ?? realPathOf)(path, signal);
  if (realPath === undefined || !isSameFile(held, await statOf(realPath))) {
    return { kind: "changed" };
  }
  const refusal = options.judge(realPath);
  if (refusal !== undefined) {
    return { kind: "refused", refusal };
  }
  if (!held.isFile()) {
    return { kind: held.isDirectory() ? "is_folder" : "unreadable" };
  }
  if (held.size > BigInt(options.maxBytes)) {
    return { kind: "too_large" };
  }
  return { kind: "read", realPath, bytes: new Uint8Array(await handle.readFile({ signal })) };
}

/**
 * Reads a file whole through one handle, and only when the handle holds the file the caller
 * judged (decision 0410): it opens `path`, then finds the path's real path, and reads when that
 * real path names the same file as the handle (one device, one file number) and `judge` accepts
 * it. A path that names another file by then is `changed`, so a link moved after a check never
 * leads the read elsewhere. Folders are `is_folder`, a named pipe and other kinds `unreadable` at
 * once, a file over `maxBytes` `too_large`; all are judged first, so a refused path tells nothing
 * of its file. Rejects with the signal's reason once it aborts.
 */
export async function readJudgedFile<R>(
  path: string,
  options: JudgedReadOptions<R>,
): Promise<JudgedFileRead<R>> {
  const { signal } = options;
  signal.throwIfAborted();
  let handle: FileHandle;
  try {
    handle = await open(path, readOpenFlags);
  } catch (error) {
    signal.throwIfAborted();
    return { kind: error instanceof Error ? faultOfOpen(error) : "unreadable" };
  }
  try {
    return await readHeld(handle, path, options);
  } catch {
    signal.throwIfAborted();
    return { kind: "unreadable" };
  } finally {
    await handle.close();
  }
}
