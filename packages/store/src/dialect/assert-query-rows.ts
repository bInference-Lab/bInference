import type { SQLOutputValue } from "node:sqlite";

/** A row as `node:sqlite` returns it: column names to SQLite values. */
export type SqliteRow = Record<string, SQLOutputValue>;

/**
 * Types the rows `node:sqlite` read for a compiled Kysely query as the query's row type. The
 * query builder fixes the row shape at compile time, which every Kysely driver relies on; a store
 * task checks its output with zod before it leaves the worker. This is the dialect's only cast.
 */
export function assertQueryRows<Row>(rows: readonly SqliteRow[]): Row[] {
  return rows as Row[];
}
