import { chmod, open } from "node:fs/promises";
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

async function syncFolder(path: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  try {
    const folder = await open(path, "r");
    try {
      await folder.sync();
    } finally {
      await folder.close();
    }
  } catch (error) {
    throw new BinferenceError({
      code: "platform.sync_failed",
      message: `Could not make what ${path} holds durable; check that the folder exists.`,
      cause: error,
      details: { path },
    });
  }
}

/**
 * Owner-only files and folders on macOS and Linux: modes `0600` and `0700`; a folder syncs with
 * an fsync of its own.
 */
export function createPosixFilePermissions(): FilePermissions {
  return {
    restrictFolder: async (path, signal) => restrict(path, 0o700, signal),
    restrictFile: async (path, signal) => restrict(path, 0o600, signal),
    syncFolder,
  };
}
