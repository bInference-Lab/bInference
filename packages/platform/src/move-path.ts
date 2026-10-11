import { lstat, rename, rm } from "node:fs/promises";
import { BinferenceError, err, ok, type Result } from "@binference/core";

async function isThere(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Moves a file or a folder to a new path on the same disk in one step: a rename, so a reader sees
 * it at one path or the other. Nothing at `from` is `not_found`, and nothing moves. The new path's
 * folder must exist and the new path must be free on Windows. Throws `platform.move_failed`.
 */
export async function movePath(
  from: string,
  to: string,
  signal: AbortSignal,
): Promise<Result<void, "not_found">> {
  signal.throwIfAborted();
  try {
    await rename(from, to);
    return ok(undefined);
  } catch (error) {
    // ENOENT also names a target folder that is missing, so only a source that is gone is one.
    if (!(await isThere(from))) {
      return err("not_found");
    }
    throw new BinferenceError({
      code: "platform.move_failed",
      message: `Could not move ${from} to ${to}; check that both are on one disk and yours.`,
      cause: error,
      details: { from, to },
    });
  }
}

/**
 * Removes a file or a folder with everything in it; nothing at `path` is no fault. Throws
 * `platform.remove_failed` when something there cannot be removed, such as a file another
 * program holds open on Windows.
 */
export async function removePath(path: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  try {
    await rm(path, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    throw new BinferenceError({
      code: "platform.remove_failed",
      message: `Could not remove ${path}; close what holds it open, then try again.`,
      cause: error,
      details: { path },
    });
  }
}
