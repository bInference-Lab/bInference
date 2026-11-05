import type { Compilable, Kysely, QueryResult } from "kysely";
import {
  executePostgresQuerySync,
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
  getPostgresKysely,
} from "./kysely-sync.js";
import type { StoreConnection } from "./store-connection.js";

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
 * Binds Kysely to a store task's connection. Queries run synchronously, so a write task's queries
 * all run inside its one transaction. The connection picks the dialect: SQLite's compiler on a
 * `node:sqlite` connection, Postgres's on a Postgres task connection, with every table named in
 * its schema. Only SQLite reports an insert's row id; Postgres reads a new key with `returning`.
 */
export function createSyncKysely<Schema>(connection: StoreConnection): SyncKysely<Schema> {
  if ("dialect" in connection) {
    const execute = <Row>(query: Compilable<Row>): QueryResult<Row> =>
      executePostgresQuerySync(connection, query);
    return {
      kysely: getPostgresKysely<Schema>(connection.schema),
      execute,
      takeFirst: (query) => execute(query).rows[0],
    };
  }
  return {
    kysely: getNodeSqliteKysely<Schema>(),
    execute: (query) => executeSqliteQuerySync(connection, query),
    takeFirst: (query) => executeSqliteQueryTakeFirstSync(connection, query),
  };
}
