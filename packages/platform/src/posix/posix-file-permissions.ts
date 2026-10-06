import { chmod } from "node:fs/promises";
import { BinferenceError } from "@binference/core";
import type { FilePermissions } from "../ports.js";

async function restrict(path: string, mode: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  try {
    await chmod(path, mode);
  } catch (error) {
    throw new BinferenceError({
      code: "platform.restrict_failed",
      message: `Could not make ${path} owner-only; check that it exists and belongs to you.`,
      cause: error,
      details: { path },
    });
  }
}

/** Owner-only files and folders on macOS and Linux: modes `0600` and `0700`. */
export function createPosixFilePermissions(): FilePermissions {
  return {
    restrictFolder: async (path, signal) => restrict(path, 0o700, signal),
    restrictFile: async (path, signal) => restrict(path, 0o600, signal),
  };
}
