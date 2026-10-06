/** SQLite's primary result codes that the store tells apart. */
export const sqliteResult = { busy: 5, locked: 6, constraint: 19 } as const;

/**
 * The primary SQLite result code of an error `node:sqlite` threw, or `undefined` for any other
 * error. The low byte of an extended result code is its primary code.
 */
export function sqlitePrimaryCode(error: Error): number | undefined {
  return "errcode" in error && typeof error.errcode === "number" ? error.errcode % 256 : undefined;
}

/** Whether another connection's lock caused the error. */
export function isSqliteLockError(error: Error["cause"]): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = sqlitePrimaryCode(error);
  return code === sqliteResult.busy || code === sqliteResult.locked;
}
