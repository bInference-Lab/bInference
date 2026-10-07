import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fresh folder for one test, and the call that removes it. */
export interface TempFolder {
  readonly path: string;
  /** Removes the folder and everything in it, retrying while Windows still holds a file. */
  remove(): Promise<void>;
}

/**
 * Creates a fresh folder under the OS's temporary folder, named `<prefix><random>`, for tests in
 * packages that open no file themselves. Keep the prefix short: a socket path under it must stay
 * within macOS's 103 bytes.
 */
export async function createTempFolder(prefix: string): Promise<TempFolder> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  return {
    path,
    remove: async () => rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}
