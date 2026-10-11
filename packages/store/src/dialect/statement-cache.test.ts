import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enableStatementCache, executeWithCachedStatement } from "./statement-cache.js";

let database: DatabaseSync;

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  enableStatementCache(database);
});

afterEach(() => {
  if (database.isOpen) {
    database.close();
  }
});

const one = { sql: "SELECT 1 AS one", parameters: [] };

function statementOf(): StatementSync {
  return executeWithCachedStatement(database, one, (statement) => statement);
}

describe("executeWithCachedStatement", () => {
  it("reuses the statement from the second run on", () => {
    const first = statementOf();
    const second = statementOf();

    expect(second).not.toBe(first);
    expect(statementOf()).toBe(second);
  });

  it("gives a nested run of the same SQL a statement of its own", () => {
    statementOf();
    const kept = statementOf();

    const nested = executeWithCachedStatement(database, one, (outer) => {
      expect(outer).toBe(kept);
      return statementOf();
    });

    expect(nested).not.toBe(kept);
    expect(statementOf()).toBe(kept);
  });

  it("forgets its statements when the content is replaced", () => {
    statementOf();
    const kept = statementOf();

    database.deserialize(database.serialize());

    // node:sqlite finalized the kept statement; comparing identities avoids reading it.
    expect(statementOf() === kept).toBe(false);
  });

  it("prepares every run on a connection that never enabled the cache", () => {
    const plain = new DatabaseSync(":memory:");
    const run = (): StatementSync =>
      executeWithCachedStatement(plain, one, (statement) => statement);

    expect(run()).not.toBe(run());
    plain.close();
  });
});
