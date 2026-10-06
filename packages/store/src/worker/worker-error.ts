import { BinferenceError } from "@binference/core";
import {
  isSqliteLockError,
  sqlitePrimaryCode,
  sqliteResult,
} from "../sqlite/sqlite-result-code.js";
import type { WorkerError, WorkerValue } from "./worker-messages.schema.js";

function sqliteError(error: Error): WorkerError | undefined {
  const primary = sqlitePrimaryCode(error);
  if (primary === undefined) {
    return undefined;
  }
  const busy = isSqliteLockError(error);
  let code: WorkerError["code"] = "store.sqlite_failed";
  if (busy) {
    code = "store.busy";
  } else if (primary === sqliteResult.constraint) {
    code = "store.constraint";
  }
  const errcode = "errcode" in error && typeof error.errcode === "number" ? error.errcode : primary;
  const errstr = "errstr" in error && typeof error.errstr === "string" ? error.errstr : "";
  return {
    code,
    message: `SQLite: ${error.message}`,
    retryable: busy,
    details: { errcode, errstr },
  };
}

/** Turns anything a worker caught into a fault the main thread can rebuild. */
export function toWorkerError(caught: WorkerValue): WorkerError {
  if (caught instanceof BinferenceError) {
    return {
      code: caught.code,
      message: caught.message,
      retryable: caught.retryable,
      details: caught.details,
    };
  }
  if (caught instanceof Error) {
    return (
      sqliteError(caught) ?? {
        code: "store.task_failed",
        message: caught.message,
        retryable: false,
        details: {},
      }
    );
  }
  return { code: "store.task_failed", message: String(caught), retryable: false, details: {} };
}
