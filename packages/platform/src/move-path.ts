import { rename, rm } from "node:fs/promises";
import { BinferenceError } from "@binference/core";

/**
 * Moves a file or a folder to a new path on the same disk in one step: a rename, so a reader sees
 * it at one path or the other. The new path's folder must exist and the new path must be free on
 * Windows. Throws `platform.move_failed`.
 */
export async function movePath(from: string, to: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  try {
    await rename(from, to);
  } catch (error) {
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
