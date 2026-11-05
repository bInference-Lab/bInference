import { BinferenceError } from "@binference/core";
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
  /**
   * Runs a query that gives a row, such as an insert with `returning`, and returns its first row.
   * No row throws `store.no_row`, which rolls the task back.
   */
  readonly takeOne: <Row>(query: Compilable<Row>) => Row;
}

function takeOneOf(
  takeFirst: <Row>(query: Compilable<Row>) => Row | undefined,
): <Row>(query: Compilable<Row>) => Row {
  return (query) => {
    const row = takeFirst(query);
    if (row === undefined) {
      throw new BinferenceError({
        code: "store.no_row",
        message: "A statement that gives a row gave none, so the store task rolled back.",
      });
    }
    return row;
  };
}

/**
 * Binds Kysely to a store task's connection. Queries run synchronously, so a write task's queries
 * all run inside its one transaction. The connection picks the dialect: SQLite's compiler on a
 * `node:sqlite` connection, Postgres's on a Postgres task connection, with every table named in
 * its schema. Only SQLite reports an insert's row id; a task reads a new key with `returning`, as
 * both databases give it.
 */
export function createSyncKysely<Schema>(connection: StoreConnection): SyncKysely<Schema> {
  if ("dialect" in connection) {
    const execute = <Row>(query: Compilable<Row>): QueryResult<Row> =>
      executePostgresQuerySync(connection, query);
    const takeFirst = <Row>(query: Compilable<Row>): Row | undefined => execute(query).rows[0];
    return {
      kysely: getPostgresKysely<Schema>(connection.schema),
      execute,
      takeFirst,
      takeOne: takeOneOf(takeFirst),
    };
  }
  const takeFirst = <Row>(query: Compilable<Row>): Row | undefined =>
    executeSqliteQueryTakeFirstSync(connection, query);
  return {
    kysely: getNodeSqliteKysely<Schema>(),
    execute: (query) => executeSqliteQuerySync(connection, query),
    takeFirst,
    takeOne: takeOneOf(takeFirst),
  };
}
