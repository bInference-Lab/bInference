import type { DatabaseSync } from "node:sqlite";
import { BinferenceError } from "@binference/core";

function rollback(database: DatabaseSync): void {
  if (database.isTransaction) {
    database.exec("ROLLBACK");
  }
}

function runTransaction<Output>(
  database: DatabaseSync,
  begin: "BEGIN IMMEDIATE" | "BEGIN",
  work: () => Output,
): Output {
  database.exec(begin);
  try {
    const output = work();
    if (typeof output === "object" && output !== null && "then" in output) {
      throw new BinferenceError({
        code: "store.async_transaction",
        message:
          "A transaction callback returned a promise. Do the async work first, then reread the rows and write in a synchronous callback.",
      });
    }
    database.exec("COMMIT");
    return output;
  } catch (error) {
    rollback(database);
    throw error;
  }
}

/**
 * Runs `work` in one write transaction (`BEGIN IMMEDIATE`, so the write lock is taken first) and
 * commits, or rolls back when it throws. `work` is synchronous: a returned promise rolls back and
 * throws `store.async_transaction`.
 */
export function writeTransaction<Output>(database: DatabaseSync, work: () => Output): Output {
  return runTransaction(database, "BEGIN IMMEDIATE", work);
}

/** Runs `work` in one read transaction, so every query in it sees the same snapshot. */
export function readTransaction<Output>(database: DatabaseSync, work: () => Output): Output {
  return runTransaction(database, "BEGIN", work);
}
