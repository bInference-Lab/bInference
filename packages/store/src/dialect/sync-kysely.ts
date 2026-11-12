import { BinferenceError } from "@binference/core";
import {
  type Compilable,
  type Expression,
  type Kysely,
  type QueryResult,
  type RawBuilder,
  sql,
} from "kysely";
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
  /**
   * The value at `path` inside the JSON text column `reference` names, such as `order.request` at
   * `["trigger", "leader"]`, or null where the path holds nothing. Only a JSON string reads the
   * same on both databases: Postgres gives every value as text, while SQLite gives a number as a
   * number, `true` as 1, and an object as its JSON without spaces. A query reads and compares
   * only fields stored as JSON strings, and a path names object keys, never array places.
   */
  readonly jsonField: (
    reference: string,
    path: readonly string[],
  ) => RawBuilder<string | number | null>;
  /** The number of items in the JSON array text of the column `reference` names. */
  readonly jsonArrayLength: (reference: string) => RawBuilder<number>;
  /**
   * A decimal text, a column's or a bound value's, as a number both databases compare and sort
   * alike: SQLite casts the text to its 64-bit integer, Postgres to `numeric`, which a
   * `numeric(78,0)` column already is. A query compares and sorts by it and never selects it,
   * since it reads back as a number on SQLite and as decimal text on Postgres.
   */
  readonly decimalNumber: (value: Expression<string>) => RawBuilder<number | string>;
}

// A key of letters and digits with a letter in it: never quoted inside either form's path, and
// never read as an array place, which only Postgres would take from a key of digits.
const jsonKey = /^[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/;

function checkedPath(path: readonly string[]): readonly string[] {
  if (path.length === 0 || !path.every((key) => jsonKey.test(key))) {
    throw new BinferenceError({
      code: "store.bad_json_path",
      message: `A JSON path names object keys of letters and digits, with a letter in each, not ${JSON.stringify(path)}.`,
    });
  }
  return path;
}

function sqliteJsonField(
  reference: string,
  path: readonly string[],
): RawBuilder<string | number | null> {
  const at = `$.${checkedPath(path).join(".")}`;
  return sql<string | number | null>`json_extract(${sql.ref(reference)}, ${at})`;
}

// Database spec, section 6.3: the text read as jsonb, and `#>>` for the text at the path.
function postgresJsonField(
  reference: string,
  path: readonly string[],
): RawBuilder<string | number | null> {
  const at = `{${checkedPath(path).join(",")}}`;
  return sql<string | null>`(${sql.ref(reference)}::jsonb #>> ${at})`;
}

function sqliteJsonArrayLength(reference: string): RawBuilder<number> {
  return sql<number>`json_array_length(${sql.ref(reference)})`;
}

function postgresJsonArrayLength(reference: string): RawBuilder<number> {
  return sql<number>`jsonb_array_length(${sql.ref(reference)}::jsonb)`;
}

function sqliteDecimalNumber(value: Expression<string>): RawBuilder<number | string> {
  return sql<number | string>`cast(${value} as integer)`;
}

function postgresDecimalNumber(value: Expression<string>): RawBuilder<number | string> {
  return sql<number | string>`cast(${value} as numeric)`;
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
      jsonField: postgresJsonField,
      jsonArrayLength: postgresJsonArrayLength,
      decimalNumber: postgresDecimalNumber,
    };
  }
  const takeFirst = <Row>(query: Compilable<Row>): Row | undefined =>
    executeSqliteQueryTakeFirstSync(connection, query);
  return {
    kysely: getNodeSqliteKysely<Schema>(),
    execute: (query) => executeSqliteQuerySync(connection, query),
    takeFirst,
    takeOne: takeOneOf(takeFirst),
    jsonField: sqliteJsonField,
    jsonArrayLength: sqliteJsonArrayLength,
    decimalNumber: sqliteDecimalNumber,
  };
}
