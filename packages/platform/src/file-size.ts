import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { BinferenceError, err, ok, type Result } from "@binference/core";

function unreadable(path: string, options: ErrorOptions = {}): BinferenceError {
  return new BinferenceError({
    code: "platform.file_read_failed",
    message: `Could not read ${path}; check that it is a regular file you can read.`,
    ...options,
    details: { path },
  });
}

/**
 * The size in bytes of the regular file at `path`; `not_found` when nothing is there. Throws
 * `platform.file_read_failed` for a folder or a path it cannot read.
 */
export async function fileSize(
  path: string,
  signal: AbortSignal,
): Promise<Result<number, "not_found">> {
  signal.throwIfAborted();
  let found: Stats;
  try {
    found = await stat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return err("not_found");
    }
    throw unreadable(path, { cause: error });
  }
  if (!found.isFile()) {
    throw unreadable(path);
  }
  return ok(found.size);
}
