import type { DatabaseSync } from "node:sqlite";
import type { Compilable, Kysely, QueryResult } from "kysely";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "./kysely-sync.js";

/** Kysely bound to one connection, with synchronous execution. */
export interface SyncKysely<Schema> {
  /** Builds and compiles queries. Its own execute() fails: run queries with the two below. */
  readonly kysely: Kysely<Schema>;
  /** Runs a query and returns its rows, or its affected-row count and insert id for a write. */
  readonly execute: <Row>(query: Compilable<Row>) => QueryResult<Row>;
  /** Runs a query and returns its first row. */
  readonly takeFirst: <Row>(query: Compilable<Row>) => Row | undefined;
}

/**
 * Binds Kysely to a `node:sqlite` connection on a store worker. Queries run synchronously, so a
 * write task's queries all run inside its one transaction.
 */
export function createSyncKysely<Schema>(database: DatabaseSync): SyncKysely<Schema> {
  return {
    kysely: getNodeSqliteKysely<Schema>(),
    execute: (query) => executeSqliteQuerySync(database, query),
    takeFirst: (query) => executeSqliteQueryTakeFirstSync(database, query),
  };
}
