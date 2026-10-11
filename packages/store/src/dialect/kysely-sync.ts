// Kysely builds and compiles the store's SQL; these helpers run the compiled SQL synchronously on a
// `node:sqlite` connection, which Kysely's own asynchronous drivers cannot do inside a transaction.

import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import { BinferenceError } from "@binference/core";
import {
  InsertQueryNode,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type Compilable,
  type CompiledQuery,
  type Dialect,
  type Driver,
  type OperationNode,
  type QueryResult,
} from "kysely";
import { assertQueryRows, type SqliteRow } from "./assert-query-rows.js";
import { isNodeReleaseAtLeast, parseNodeRelease } from "./node-release.js";
import { sqlParameters } from "./sql-parameters.js";
import { executeWithCachedStatement } from "./statement-cache.js";

/**
 * Before Node 26.6.0, `StatementSync.all()` counted a statement's columns before its first step,
 * so a statement SQLite prepared again after a schema change could read rows with the old column
 * list. Iterating reads the columns of each row and has no such problem.
 */
const allCountsColumnsAfterStep = isNodeReleaseAtLeast(parseNodeRelease(process.versions.node), {
  major: 26,
  minor: 6,
  patch: 0,
});

const nothing = (): Promise<void> => Promise.resolve();

/**
 * A Kysely driver with no connection to give: Kysely compiles with it, and every attempt to run a
 * query through Kysely itself fails loudly instead of running it on nothing.
 */
function compileOnlyDriver(): Driver {
  return {
    init: nothing,
    acquireConnection: () =>
      Promise.reject(
        new BinferenceError({
          code: "store.compile_only",
          message:
            "This Kysely instance only compiles queries; run them with the store's synchronous execute helpers.",
        }),
      ),
    beginTransaction: nothing,
    commitTransaction: nothing,
    rollbackTransaction: nothing,
    releaseConnection: nothing,
    destroy: nothing,
  };
}

/** SQLite's compiler, adapter and introspector, with the driver above. */
const compileOnlyDialect: Dialect = {
  createAdapter: () => new SqliteAdapter(),
  createDriver: compileOnlyDriver,
  createIntrospector: (kysely) => new SqliteIntrospector(kysely),
  createQueryCompiler: () => new SqliteQueryCompiler(),
};

/**
 * A Kysely instance that builds and compiles SQLite queries. Its own `execute()` rejects with
 * `store.compile_only`: run its queries with {@link executeSqliteQuerySync}.
 */
export function getNodeSqliteKysely<Schema>(): Kysely<Schema> {
  return new Kysely<Schema>({ dialect: compileOnlyDialect });
}

/**
 * Reads every row of a statement by stepping through it, which leaves the statement reset. The
 * same rows as `all()`, for Node releases whose `all()` can misread a re-prepared statement.
 */
export function readRowsByIteration(
  statement: StatementSync,
  parameters: readonly SQLInputValue[],
): SqliteRow[] {
  const rows: SqliteRow[] = [];
  for (const row of statement.iterate(...parameters)) {
    rows.push(row);
  }
  return rows;
}

function readRows<Row>(statement: StatementSync, parameters: readonly SQLInputValue[]): Row[] {
  statement.setReadBigInts(false);
  const rows = allCountsColumnsAfterStep
    ? statement.all(...parameters)
    : readRowsByIteration(statement, parameters);
  return assertQueryRows<Row>(rows);
}

/**
 * Runs a statement that returns no rows. Its counts are read as bigints, so a row id past
 * `Number.MAX_SAFE_INTEGER` keeps all 64 bits; only an insert reports the row id.
 */
function write<Row>(
  statement: StatementSync,
  parameters: readonly SQLInputValue[],
  query: OperationNode,
): QueryResult<Row> {
  statement.setReadBigInts(true);
  const { changes, lastInsertRowid } = statement.run(...parameters);
  const numAffectedRows = BigInt(changes);
  return InsertQueryNode.is(query)
    ? { rows: [], numAffectedRows, insertId: BigInt(lastInsertRowid) }
    : { rows: [], numAffectedRows };
}

function runCompiled<Row>(database: DatabaseSync, compiled: CompiledQuery<Row>): QueryResult<Row> {
  const bound = { sql: compiled.sql, parameters: sqlParameters(compiled.parameters) };
  return executeWithCachedStatement(database, bound, (statement) =>
    // A statement with result columns is a select or a write with `returning`: it gives rows.
    statement.columns().length > 0
      ? { rows: readRows<Row>(statement, bound.parameters) }
      : write<Row>(statement, bound.parameters, compiled.query),
  );
}

/**
 * Runs a Kysely query on the connection and returns its rows, or for a write without
 * `returning` the affected-row count (and the row id of an insert).
 */
export function executeSqliteQuerySync<Row>(
  database: DatabaseSync,
  query: Compilable<Row>,
): QueryResult<Row> {
  return runCompiled(database, query.compile());
}

/** Runs a Kysely query on the connection and returns its first row, if any. */
export function executeSqliteQueryTakeFirstSync<Row>(
  database: DatabaseSync,
  query: Compilable<Row>,
): Row | undefined {
  return runCompiled(database, query.compile()).rows[0];
}
