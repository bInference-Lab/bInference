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

// SQLSTATE 23505 and 23P01: a unique or exclusion key in use. A writer that never read the key
// meets a concurrent insert of it as one of these rather than 40001, so one rerun from the first
// read, which reads the key, answers it (decision 0413).
const uniqueStates = new Set(["23505", "23P01"]);

/** Whether the server refused a write for a unique or exclusion key in use. */
export function isUniqueViolation(error: Caught): boolean {
  return uniqueStates.has(sqlStateOf(error) ?? "");
}

// SQLSTATE P0001, a PL/pgSQL `RAISE EXCEPTION` with no code of its own: in the store's schemas
// only a trigger or a migration that refuses a write raises it (the ledger's chain, the append-only
// ledger and transcript), as SQLite's `RAISE(ABORT)` refuses one.
const refusedState = "P0001";

/** Whether the server refused a write for a broken constraint or a trigger's refusal. */
function isConstraintState(state: string): boolean {
  return state.startsWith("23") || state === refusedState;
}

/**
 * Turns an error a Postgres store call caught into the fault it throws: a `BinferenceError` or an
 * abort's reason passes unchanged, a broken constraint or a trigger's refusal is
 * `store.constraint` as on SQLite, any other error the server sent is `store.postgres_failed` with
 * its SQLSTATE, and an error with no SQLSTATE, such as a lost connection, is the retryable
 * `store.postgres_unreachable`.
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
    code: isConstraintState(state) ? "store.constraint" : "store.postgres_failed",
    message: `Postgres: ${message}`,
    cause: error,
    details: { sqlState: state },
  });
}

/**
 * The fault of a write whose `COMMIT` answer was lost and whose ending the database could not tell
 * within 10 s (decision 0438), with its transaction id when it had one.
 */
export function commitUnknown(cause: Caught, transactionId: string | undefined): BinferenceError {
  return new BinferenceError({
    code: "store.commit_unknown",
    message:
      "The connection to Postgres ended while a write was committing, and the database could not tell within 10 seconds whether it took effect. Its store host writes nothing more: stop the install's engine and runtime, and their next start reads the rows.",
    cause,
    details: transactionId === undefined ? {} : { transactionId },
  });
}

/** The fault of a write a store host refused because an earlier write's commit is unknown. */
export function commitStillUnknown(earlier: BinferenceError): BinferenceError {
  return new BinferenceError({
    code: "store.commit_unknown",
    message:
      "An earlier write of this store host lost its COMMIT answer, and the database could not tell how it ended, so this host writes nothing more. Stop the install's engine and runtime; their next start reads the rows.",
    cause: earlier,
    details: earlier.details,
  });
}

/**
 * The fault of a write whose every try lost its `COMMIT` answer, each one known by the database not
 * to have landed: nothing changed, and the call may run again later.
 */
export function commitsLost(attempts: number): BinferenceError {
  return new BinferenceError({
    code: "store.postgres_unreachable",
    message: `Postgres lost the COMMIT of a write ${String(attempts)} times, and none of them landed; nothing changed. Try the call again.`,
    retryable: true,
    details: { attempts },
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
