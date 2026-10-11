// Prepared statements kept per connection, so SQL that repeats is compiled by SQLite only once.

import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";

/** How many prepared statements one connection keeps. */
const maxStatements = 64;
/** How many SQL texts one connection remembers as run once, waiting for a second run. */
const maxCandidates = 64;
/**
 * The largest SQL text plus bound text and bytes a kept statement may hold, in bytes. SQLite keeps
 * the last bound values with the statement, so a large value would stay in memory with it.
 */
const maxKeptBytes = 64 * 1024;

type Authorizer = Parameters<DatabaseSync["setAuthorizer"]>[0];

/** The statements of one connection, and whether they may be used now. */
interface Statements {
  /** Kept statements by SQL text, least recently used first. */
  readonly kept: Map<string, StatementSync>;
  /** SQL texts that ran once and are kept if they run again, oldest first. */
  readonly candidates: Set<string>;
  /** Statements running right now; a nested run of the same SQL gets a statement of its own. */
  readonly running: Set<StatementSync>;
  /** Set while an authorizer is installed: it must see every statement as it is prepared. */
  authorized: boolean;
}

/** SQL text with the values it binds. */
export interface BoundSql {
  readonly sql: string;
  readonly parameters: readonly SQLInputValue[];
}

const connections = new WeakMap<DatabaseSync, Statements>();

function forget(statements: Statements): void {
  statements.kept.clear();
  statements.candidates.clear();
}

/**
 * Sets up the statements of a connection, and wraps the connection methods after which a kept
 * statement could act wrongly: `setAuthorizer` (an authorizer only sees statements as they are
 * prepared), `deserialize` (the content is replaced) and `close` (the statements end with it).
 */
function watchConnection(database: DatabaseSync): Statements {
  const statements: Statements = {
    kept: new Map(),
    candidates: new Set(),
    running: new Set(),
    authorized: false,
  };
  const setAuthorizer = database.setAuthorizer.bind(database);
  const deserialize = database.deserialize.bind(database);
  const close = database.close.bind(database);
  Object.defineProperties(database, {
    setAuthorizer: {
      configurable: true,
      value: (callback: Authorizer): void => {
        forget(statements);
        statements.authorized = callback !== null;
        setAuthorizer(callback);
      },
    },
    deserialize: {
      configurable: true,
      value: (...args: Parameters<DatabaseSync["deserialize"]>): void => {
        forget(statements);
        deserialize(...args);
      },
    },
    close: {
      configurable: true,
      value: (): void => {
        forget(statements);
        close();
      },
    },
  });
  return statements;
}

/**
 * Lets {@link executeWithCachedStatement} keep prepared statements for this connection. Call it
 * once, right after the connection opens.
 */
export function enableStatementCache(database: DatabaseSync): void {
  if (!connections.has(database)) {
    connections.set(database, watchConnection(database));
  }
}

function byteSize(value: SQLInputValue): number {
  if (typeof value === "string") {
    return Buffer.byteLength(value, "utf8");
  }
  return ArrayBuffer.isView(value) ? value.byteLength : 8;
}

function smallEnoughToKeep(sql: string, parameters: readonly SQLInputValue[]): boolean {
  let total = Buffer.byteLength(sql, "utf8");
  for (const value of parameters) {
    total += byteSize(value);
    if (total > maxKeptBytes) {
      return false;
    }
  }
  return total <= maxKeptBytes;
}

function dropOldest(entries: Map<string, StatementSync> | Set<string>): void {
  const oldest = entries.keys().next();
  if (oldest.done !== true) {
    entries.delete(oldest.value);
  }
}

/**
 * The statement to run `sql` with: the kept one when it is idle, otherwise a new one, which is
 * kept when this is the SQL's second run. SQL that may not be kept always gets a new statement.
 */
function pickStatement(
  database: DatabaseSync,
  statements: Statements,
  { sql, parameters }: BoundSql,
): StatementSync {
  const keepable = !statements.authorized && smallEnoughToKeep(sql, parameters);
  const kept = keepable ? statements.kept.get(sql) : undefined;
  if (kept !== undefined && !statements.running.has(kept)) {
    // Move it to the most recently used end.
    statements.kept.delete(sql);
    statements.kept.set(sql, kept);
    return kept;
  }
  const statement = database.prepare(sql);
  if (!keepable || kept !== undefined) {
    return statement;
  }
  if (!statements.candidates.delete(sql)) {
    statements.candidates.add(sql);
    if (statements.candidates.size > maxCandidates) {
      dropOldest(statements.candidates);
    }
    return statement;
  }
  statements.kept.set(sql, statement);
  if (statements.kept.size > maxStatements) {
    dropOldest(statements.kept);
  }
  return statement;
}

/**
 * Runs `execute` with a prepared statement for `sql`. A connection set up with
 * {@link enableStatementCache} prepares SQL that runs a second time once and reuses it after;
 * statements whose text and bound values are large, and every statement while an authorizer is
 * installed, are prepared for the one run.
 */
export function executeWithCachedStatement<Output>(
  database: DatabaseSync,
  bound: BoundSql,
  execute: (statement: StatementSync) => Output,
): Output {
  const statements = connections.get(database);
  if (statements === undefined || !database.isOpen) {
    // A closed connection makes prepare() throw its "not open" error.
    if (statements !== undefined) {
      forget(statements);
    }
    return execute(database.prepare(bound.sql));
  }
  const statement = pickStatement(database, statements, bound);
  statements.running.add(statement);
  try {
    return execute(statement);
  } finally {
    statements.running.delete(statement);
  }
}
