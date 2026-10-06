import { DatabaseSync } from "node:sqlite";
import { BinferenceError, err, ok, type Result } from "@binference/core";

/** An exclusive OS file lock this process holds. */
export interface FileLock {
  /** Frees the lock. Safe to call more than once. */
  release(): void;
}

const sqliteBusy = 5;

function isBusy(error: Error): boolean {
  return "errcode" in error && error.errcode === sqliteBusy;
}

function openLockFile(path: string): DatabaseSync {
  try {
    return new DatabaseSync(path, { timeout: 0 });
  } catch (error) {
    throw new BinferenceError({
      code: "platform.lock_failed",
      message: `Could not open the lock file ${path}; check that its folder exists and is yours.`,
      cause: error,
      details: { path },
    });
  }
}

/**
 * Takes an exclusive OS lock on the file at `path` without waiting, creating the file when it is
 * missing. Returns `held` while another holder has it, in another process or in this one. The OS
 * frees the lock when the holder's process ends, even after a crash, so no stale lock is left. On
 * macOS and Linux, closing any other descriptor of the lock file in this process frees the lock
 * too, so nothing else opens it.
 */
export function acquireFileLock(path: string): Result<FileLock, "held"> {
  // SQLite takes the lock through the OS (fcntl on POSIX, LockFileEx on Windows); Node has no
  // file lock of its own. One non-blocking statement on the main thread, and no rows.
  const database = openLockFile(path);
  try {
    database.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    database.close();
    if (error instanceof Error && isBusy(error)) {
      return err("held");
    }
    throw new BinferenceError({
      code: "platform.lock_failed",
      message: `Could not lock ${path}.`,
      cause: error,
      details: { path },
    });
  }
  return ok({
    release: () => {
      if (database.isOpen) {
        database.close();
      }
    },
  });
}
