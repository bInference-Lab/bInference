import { BinferenceError } from "@binference/core";
import { DatabaseError } from "pg";

/** Anything a `catch` holds. */
type Caught = Error["cause"];

// SQLSTATE 40001 and 40P01: the server refused the transaction to keep a serial order, or broke a
// deadlock. Either rolled the whole transaction back, so running it again from its first read is
// safe (decision 0366).
const conflictStates = new Set(["40001", "40P01"]);

/** The SQLSTATE of an error the server sent, or `undefined` for any other error. */
export function sqlStateOf(error: Caught): string | undefined {
  return error instanceof DatabaseError ? error.code : undefined;
}

/** Whether the server rolled a transaction back for a serialization failure or a deadlock. */
export function isWriteConflict(error: Caught): boolean {
  return conflictStates.has(sqlStateOf(error) ?? "");
}

/**
 * Turns an error a Postgres store call caught into the fault it throws: a `BinferenceError` or an
 * abort's reason passes unchanged, a broken constraint is `store.constraint` as on SQLite, any
 * other error the server sent is `store.postgres_failed` with its SQLSTATE, and an error with no
 * SQLSTATE, such as a lost connection, is the retryable `store.postgres_unreachable`.
 */
export function storeFaultOf(error: Caught, signal: AbortSignal): Caught {
  if (error instanceof BinferenceError || (signal.aborted && error === signal.reason)) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const state = sqlStateOf(error);
  if (state === undefined) {
    return new BinferenceError({
      code: "store.postgres_unreachable",
      message: `Postgres could not be reached: ${message}`,
      retryable: true,
      cause: error,
    });
  }
  return new BinferenceError({
    code: state.startsWith("23") ? "store.constraint" : "store.postgres_failed",
    message: `Postgres: ${message}`,
    cause: error,
    details: { sqlState: state },
  });
}

/** The fault of a write whose `COMMIT` was in flight when its connection was lost or aborted. */
export function commitUnknown(cause: Caught): BinferenceError {
  return new BinferenceError({
    code: "store.commit_unknown",
    message:
      "The connection to Postgres ended while a write was committing, so it may or may not have taken effect. Read the rows again before deciding again; never repeat the write blindly.",
    cause,
  });
}

/** The fault of a write that still met a conflict after its last retry. */
export function writeConflict(attempts: number, cause: Caught): BinferenceError {
  return new BinferenceError({
    code: "store.write_conflict",
    message: `A Postgres write met a concurrent write ${String(attempts)} times and rolled back each time; nothing changed. Try the call again.`,
    retryable: true,
    cause,
    details: { attempts, sqlState: sqlStateOf(cause) ?? "" },
  });
}
