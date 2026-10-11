import { resolve, toNamespacedPath } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BinferenceError } from "@binference/core";
import { enableStatementCache } from "../dialect/statement-cache.js";
import { isSqliteLockError } from "./sqlite-result-code.js";

/** Who holds a connection: the one writer of a database, or one of its readers. */
export type ConnectionRole = "writer" | "reader";

/** SQLite's `synchronous` setting: `full` for the engine's money records, `normal` otherwise. */
export type Synchronous = "full" | "normal";

/** How {@link openConnection} sets up a connection. */
export interface ConnectionOptions {
  readonly role: ConnectionRole;
  readonly synchronous: Synchronous;
}

/** How long a statement waits for another connection's lock before it fails. */
export const busyTimeoutMs = 5_000;

/** How long to wait between two attempts to switch the journal to WAL. */
const walAttemptGapMs = 10;
const gapClock = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

function journalMode(database: DatabaseSync, pragma: string): string {
  const [mode] = Object.values(database.prepare(pragma).get() ?? {});
  return typeof mode === "string" ? mode.toLowerCase() : String(mode);
}

/**
 * Puts the database in WAL mode and returns the journal mode SQLite reports afterwards. WAL is
 * kept in the file, so a database already in WAL needs no change. Changing the mode takes an
 * exclusive lock, and SQLite may answer a busy or locked error at once instead of calling the busy
 * handler (when waiting could deadlock, or while another connection recovers the log), so the
 * switch is tried again until the busy timeout has passed.
 */
function switchToWal(database: DatabaseSync): string {
  const deadline = performance.now() + busyTimeoutMs;
  for (;;) {
    try {
      const current = journalMode(database, "PRAGMA journal_mode");
      return current === "wal" ? current : journalMode(database, "PRAGMA journal_mode = WAL");
    } catch (error) {
      if (!isSqliteLockError(error) || performance.now() >= deadline) {
        throw error;
      }
      // A worker thread may block; nothing else runs on it while the database opens.
      Atomics.wait(gapClock, 0, 0, walAttemptGapMs);
    }
  }
}

function applySettings(database: DatabaseSync, options: ConnectionOptions): void {
  const mode = switchToWal(database);
  if (mode !== "wal") {
    throw new BinferenceError({
      code: "store.wal_unavailable",
      message: `SQLite kept the journal mode ${mode} instead of WAL; keep the database on a local disk.`,
      details: { mode },
    });
  }
  database.exec(
    options.synchronous === "full" ? "PRAGMA synchronous = FULL" : "PRAGMA synchronous = NORMAL",
  );
  // macOS flushes the disk cache only with F_FULLFSYNC; other systems ignore this setting.
  database.exec(
    options.synchronous === "full"
      ? "PRAGMA checkpoint_fullfsync = ON"
      : "PRAGMA checkpoint_fullfsync = OFF",
  );
  database.exec("PRAGMA foreign_keys = ON");
  if (options.role === "reader") {
    database.exec("PRAGMA query_only = ON");
  }
}

/**
 * Opens a database file for a store worker: WAL, foreign keys, the given `synchronous` level, and
 * `query_only` for a reader. Creates the file when it is missing; its folder must exist.
 */
export function openConnection(file: string, options: ConnectionOptions): DatabaseSync {
  let database: DatabaseSync;
  try {
    // The busy timeout must apply before the first statement: setting WAL while another
    // connection recovers the log otherwise fails at once with SQLITE_BUSY_RECOVERY. Windows
    // hands the path to SQLite unchanged, so long paths need the namespace prefix.
    database = new DatabaseSync(toNamespacedPath(resolve(file)), { timeout: busyTimeoutMs });
  } catch (error) {
    throw new BinferenceError({
      code: "store.open_failed",
      message: `Could not open the database ${file}; check that its folder exists and is yours.`,
      cause: error,
      details: { file },
    });
  }
  try {
    applySettings(database, options);
    enableStatementCache(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
