import { open } from "node:fs/promises";
import { BinferenceError, err, ok, type Result } from "@binference/core";

/** The largest file {@link readTextFile} reads: config and secret files are small. */
const maxBytes = 1_048_576;

function isMissing(error: Error): boolean {
  return "code" in error && error.code === "ENOENT";
}

async function readWhole(path: string, signal: AbortSignal): Promise<string> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size > maxBytes) {
      throw new BinferenceError({
        code: "platform.file_too_large",
        message: `${path} holds ${String(size)} bytes; the most it may hold is ${String(maxBytes)}.`,
        details: { path, bytes: size },
      });
    }
    return await handle.readFile({ encoding: "utf8", signal });
  } finally {
    await handle.close();
  }
}

/**
 * Reads a UTF-8 text file of at most 1 MiB. Returns `not_found` when nothing exists at `path`;
 * throws `platform.file_read_failed` when the file cannot be read and `platform.file_too_large`
 * when it is bigger than 1 MiB. The text comes back as written, byte order mark included.
 */
export async function readTextFile(
  path: string,
  signal: AbortSignal,
): Promise<Result<string, "not_found">> {
  signal.throwIfAborted();
  try {
    return ok(await readWhole(path, signal));
  } catch (error) {
    if (error instanceof BinferenceError || signal.aborted) {
      throw error;
    }
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
