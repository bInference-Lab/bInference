// Adapted from MIT-licensed code; NOTICES.md holds its notice. Changed: the execute path only
// (no prepared bindings, iterators or string sets yet); no Kysely cache per connection, no reader
// lifecycle and no query-error hook; bound values are checked; long functions are split.
import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import { BinferenceError } from "@binference/core";
import type { Compilable, CompiledQuery, QueryResult } from "kysely";
import { InsertQueryNode, Kysely, SelectQueryNode, SqliteDialect } from "kysely";
import { assertQueryRows, type SqliteRow } from "./assert-query-rows.js";
import { isNodeReleaseAtLeast, parseNodeRelease } from "./node-release.js";
import { sqlParameters } from "./sql-parameters.js";
import { executeWithCachedStatement } from "./statement-cache.js";

// Node 24.20 and 26.6 fixed all() column counts after a statement is prepared again
// (nodejs/node#64219). Earlier releases read rows through iterate() instead.
const nodeRelease = parseNodeRelease(process.versions.node);
const readsAllAfterReprepare =
  (nodeRelease?.major === 24 &&
    isNodeReleaseAtLeast(nodeRelease, { major: 24, minor: 20, patch: 0 })) ||
  isNodeReleaseAtLeast(nodeRelease, { major: 26, minor: 6, patch: 0 });

// The database factory runs only when Kysely itself would execute, so compiling works and a
// direct execute() fails at once.
const compileOnlyDialect = new SqliteDialect({
  database: () =>
    Promise.reject(
      new BinferenceError({
        code: "store.compile_only",
        message: "This Kysely only compiles queries; run them with executeSqliteQuerySync.",
      }),
    ),
});

/** A Kysely that compiles queries for `node:sqlite`; its own execute() always fails. */
export function getNodeSqliteKysely<Schema>(): Kysely<Schema> {
  return new Kysely<Schema>({ dialect: compileOnlyDialect });
}

/**
 * Reads every row by iterating, for Node releases whose all() can miscount columns after a
 * statement is prepared again. The iterator reads columns after each step.
 */
export function readRowsByIteration(
  statement: StatementSync,
  parameters: readonly SQLInputValue[],
): SqliteRow[] {
  const iterator = statement.iterate(...parameters);
  const rows: SqliteRow[] = [];
  try {
    for (const row of iterator) {
      rows.push(row);
    }
  } finally {
    iterator.return?.();
  }
  return rows;
}

function readRows(statement: StatementSync, parameters: readonly SQLInputValue[]): SqliteRow[] {
  return readsAllAfterReprepare
    ? statement.all(...parameters)
    : readRowsByIteration(statement, parameters);
}

// SQLite keeps a 64-bit last row id per connection even for UPDATE and DELETE. Reading bigints
// while the write runs keeps a valid write from failing on an id past Number.MAX_SAFE_INTEGER.
function runWrite<Row>(
  statement: StatementSync,
  parameters: readonly SQLInputValue[],
  query: CompiledQuery<Row>,
): QueryResult<Row> {
  statement.setReadBigInts(true);
  let outcome: ReturnType<StatementSync["run"]>;
  try {
    outcome = statement.run(...parameters);
  } finally {
    statement.setReadBigInts(false);
  }
  const changes = BigInt(outcome.changes);
  if (InsertQueryNode.is(query.query) && changes > 0n) {
    return { numAffectedRows: changes, insertId: BigInt(outcome.lastInsertRowid), rows: [] };
  }
  return { numAffectedRows: changes, rows: [] };
}

/** One compiled query with its checked values, and whether only its first row is wanted. */
interface QueryRun<Row> {
  readonly query: CompiledQuery<Row>;
  readonly parameters: readonly SQLInputValue[];
  readonly rows: "first" | "all";
}

function executeStatement<Row>(statement: StatementSync, run: QueryRun<Row>): QueryResult<Row> {
  const isSelect = SelectQueryNode.is(run.query.query);
  if (run.rows === "first" && isSelect) {
    // get() reads columns after the step and resets the statement before it returns.
    const row = statement.get(...run.parameters);
    return { rows: assertQueryRows<Row>(row === undefined ? [] : [row]) };
  }
  // A select always returns rows; raw SQL and other roots ask the statement.
  if (isSelect || statement.columns().length > 0) {
    return { rows: assertQueryRows<Row>(readRows(statement, run.parameters)) };
  }
  return runWrite(statement, run.parameters, run.query);
}

function executeCompiled<Row>(
  database: DatabaseSync,
  query: CompiledQuery<Row>,
  rows: "first" | "all",
): QueryResult<Row> {
  const parameters = sqlParameters(query.parameters);
  return executeWithCachedStatement(database, { sql: query.sql, parameters }, (statement) =>
    executeStatement(statement, { query, parameters, rows }),
  );
}

/** Compiles a Kysely query and runs it on `database` synchronously. */
export function executeSqliteQuerySync<Row>(
  database: DatabaseSync,
  query: Compilable<Row>,
): QueryResult<Row> {
  return executeCompiled(database, query.compile(), "all");
}

/** Compiles a Kysely query, runs it synchronously and returns its first row. */
export function executeSqliteQueryTakeFirstSync<Row>(
  database: DatabaseSync,
  query: Compilable<Row>,
): Row | undefined {
  return executeCompiled(database, query.compile(), "first").rows[0];
}
