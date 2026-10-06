// Adapted from MIT-licensed code; NOTICES.md holds its notice. Changed: the Kysely and
// query-error maps, dispose callbacks and the global singleton are left out; symbol keys are
// renamed; long functions are split.
import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";

// Cached statements retain their database. The wrappers installed below clear the cache before
// close, so statements release their native back references.
const statementCacheKey: unique symbol = Symbol.for("binference.store.statementCache");
const invalidationKey: unique symbol = Symbol.for("binference.store.statementInvalidation");
const cacheEnabledKey: unique symbol = Symbol.for("binference.store.statementCacheEnabled");
const authorizerActiveKey: unique symbol = Symbol.for("binference.store.authorizerActive");
// Up to 4 MiB of SQL plus bindings per enabled connection.
const statementCacheCapacity = 64;
const statementCacheEntryBytes = 64 * 1024;

type SqliteAuthorizer = Parameters<DatabaseSync["setAuthorizer"]>[0];

interface StatementCache {
  readonly statements: Map<string, StatementSync>;
  readonly candidates: Set<string>;
  readonly active: WeakSet<StatementSync>;
}

type StatementCacheOwner = DatabaseSync & {
  [statementCacheKey]?: StatementCache;
  [invalidationKey]?: true;
  [cacheEnabledKey]?: true;
  [authorizerActiveKey]?: boolean;
};

function clearStatementCache(owner: StatementCacheOwner): void {
  Reflect.deleteProperty(owner, statementCacheKey);
}

// Authorization is decided while SQL compiles, so every change drops every statement.
function wrapAuthorizer(owner: StatementCacheOwner): void {
  const setAuthorizer = owner.setAuthorizer.bind(owner);
  Object.defineProperty(owner, "setAuthorizer", {
    configurable: true,
    writable: true,
    value(this: StatementCacheOwner, callback: SqliteAuthorizer): void {
      setAuthorizer(callback);
      this[authorizerActiveKey] = callback !== null;
      clearStatementCache(this);
    },
  });
}

// Node finalizes every statement before it deserializes, even when that fails.
function wrapDeserialize(owner: StatementCacheOwner): void {
  const deserialize = owner.deserialize.bind(owner);
  Object.defineProperty(owner, "deserialize", {
    configurable: true,
    writable: true,
    value(this: StatementCacheOwner, ...values: Parameters<DatabaseSync["deserialize"]>): void {
      try {
        deserialize(...values);
      } finally {
        clearStatementCache(this);
      }
    },
  });
}

function wrapClose(owner: StatementCacheOwner): void {
  for (const method of ["close", Symbol.dispose] as const) {
    const dispose = owner[method].bind(owner);
    Object.defineProperty(owner, method, {
      configurable: true,
      writable: true,
      value(this: StatementCacheOwner): void {
        clearStatementCache(this);
        dispose();
      },
    });
  }
}

function installStatementInvalidation(owner: StatementCacheOwner): void {
  if (owner[invalidationKey] === true) {
    return;
  }
  wrapAuthorizer(owner);
  wrapDeserialize(owner);
  wrapClose(owner);
  Object.defineProperty(owner, invalidationKey, { configurable: true, value: true });
}

/**
 * Keeps up to 64 prepared statements on this connection, each admitted on its second use. Call it
 * once, right after the connection opens and before any authorizer is set.
 */
export function enableStatementCache(database: DatabaseSync): void {
  const owner: StatementCacheOwner = database;
  installStatementInvalidation(owner);
  owner[cacheEnabledKey] = true;
}

function fitsStatementCache(sql: string, parameters: readonly SQLInputValue[]): boolean {
  let bytes = Buffer.byteLength(sql);
  for (const parameter of parameters) {
    if (typeof parameter === "string") {
      // UTF-8 is never shorter than UTF-16 code units, so an oversized value stops here.
      if (parameter.length > statementCacheEntryBytes - bytes) {
        return false;
      }
      bytes += Buffer.byteLength(parameter);
    } else if (ArrayBuffer.isView(parameter)) {
      bytes += parameter.byteLength;
    }
  }
  return bytes <= statementCacheEntryBytes;
}

function cacheOf(owner: StatementCacheOwner): StatementCache {
  const existing = owner[statementCacheKey];
  if (existing !== undefined) {
    return existing;
  }
  const cache: StatementCache = {
    statements: new Map(),
    candidates: new Set(),
    active: new WeakSet(),
  };
  Object.defineProperty(owner, statementCacheKey, { configurable: true, value: cache });
  return cache;
}

function dropOldest<T>(entries: Map<T, StatementSync> | Set<T>): void {
  const oldest = entries.keys().next();
  if (oldest.done !== true) {
    entries.delete(oldest.value);
  }
}

// Admits SQL on its second use, so one-shot SQL with a varying placeholder count never fills the
// cache. A statement in use by an outer call is never handed out again: a SQLite callback can
// re-enter here synchronously, and resetting the outer statement would corrupt its read.
function statementFor(cache: StatementCache, database: DatabaseSync, sql: string): StatementSync {
  const cached = cache.statements.get(sql);
  if (cached !== undefined && !cache.active.has(cached)) {
    cache.statements.delete(sql);
    cache.statements.set(sql, cached);
    return cached;
  }
  const statement = database.prepare(sql);
  if (cached === undefined && cache.candidates.delete(sql)) {
    cache.statements.set(sql, statement);
    if (cache.statements.size > statementCacheCapacity) {
      dropOldest(cache.statements);
    }
  } else if (cached === undefined) {
    cache.candidates.add(sql);
    if (cache.candidates.size > statementCacheCapacity) {
      dropOldest(cache.candidates);
    }
  }
  return statement;
}

/** SQL and the values it binds. */
export interface BoundSql {
  readonly sql: string;
  readonly parameters: readonly SQLInputValue[];
}

/**
 * Runs `execute` with a prepared statement for the SQL, from the cache when the connection
 * enabled it. `execute` must finish with the statement before it returns.
 */
export function executeWithCachedStatement<Output>(
  database: DatabaseSync,
  { sql, parameters }: BoundSql,
  execute: (statement: StatementSync) => Output,
): Output {
  const owner: StatementCacheOwner = database;
  if (
    owner[cacheEnabledKey] !== true ||
    owner[authorizerActiveKey] === true ||
    !fitsStatementCache(sql, parameters)
  ) {
    return execute(database.prepare(sql));
  }
  const cache = cacheOf(owner);
  const statement = statementFor(cache, database, sql);
  cache.active.add(statement);
  try {
    return execute(statement);
  } finally {
    cache.active.delete(statement);
  }
}
