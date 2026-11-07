import { open, realpath } from "node:fs/promises";
import { err, ok, type Result } from "@binference/core";

/** Why a file's bytes were not read: nothing is there, it is bigger than allowed, or not a file. */
export type FileBytesRefusal = "not_found" | "too_large" | "unreadable";

function codeOf(error: Error): string | undefined {
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
}

/**
 * The real path of `path`, every link on the way resolved, or `undefined` when nothing is there.
 * A caller that keeps folders apart, such as binference's own, checks the real path, so a link
 * cannot lead into one.
 */
export async function realPathOf(path: string, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted();
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

/**
 * Reads a file's bytes whole, at most `maxBytes` of them: `too_large` when it holds more, read
 * from its size before any byte; `not_found` when nothing is at `path`; `unreadable` for a folder
 * or a file the process may not read. Rejects with the signal's reason once it aborts.
 */
export async function readFileBytes(
  path: string,
  options: { readonly maxBytes: number; readonly signal: AbortSignal },
): Promise<Result<Uint8Array, FileBytesRefusal>> {
  const { maxBytes, signal } = options;
  signal.throwIfAborted();
  try {
    const handle = await open(path, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) {
        return err("unreadable");
      }
      if (stat.size > maxBytes) {
        return err("too_large");
      }
      return ok(new Uint8Array(await handle.readFile({ signal })));
    } finally {
      await handle.close();
    }
  } catch (error) {
    signal.throwIfAborted();
    return error instanceof Error && codeOf(error) === "ENOENT"
      ? err("not_found")
      : err("unreadable");
  }
}
