import { access } from "node:fs/promises";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a database file was left open: its write-ahead log (`-wal`) or its shared-memory index
 * (`-shm`) is there. SQLite removes both when the last connection closes the database cleanly, so
 * either one means an engine still runs on it, stopped without closing it, or the files were
 * copied while one ran.
 */
export async function isDatabaseLeftOpen(file: string, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  const found = await Promise.all([exists(`${file}-wal`), exists(`${file}-shm`)]);
  return found.some(Boolean);
}
