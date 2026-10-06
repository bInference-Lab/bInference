import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Generated } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openConnection } from "../sqlite/open-connection.worker.js";
import { getNodeSqliteKysely, readRowsByIteration } from "./kysely-sync.js";
import { createSyncKysely, type SyncKysely } from "./sync-kysely.js";

interface Tables {
  items: { id: Generated<number>; name: string; amount: string };
}

let folder = "";
let database: DatabaseSync;
let sync: SyncKysely<Tables>;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "bnf-store-"));
  database = openConnection(join(folder, "test.sqlite"), { role: "writer", synchronous: "normal" });
  database.exec(
    "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, amount TEXT NOT NULL) STRICT",
  );
  sync = createSyncKysely<Tables>(database);
});

afterEach(() => {
  if (database.isOpen) {
    database.close();
  }
  rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
});

function insert(name: string, amount: string): void {
  sync.execute(sync.kysely.insertInto("items").values({ name, amount }));
}

describe("executeSqliteQuerySync", () => {
  it("returns the insert id and the affected rows of a write", () => {
    const result = sync.execute(sync.kysely.insertInto("items").values({ name: "a", amount: "1" }));

    expect(result).toStrictEqual({ numAffectedRows: 1n, insertId: 1n, rows: [] });
  });

  it("returns the affected rows of an update without an insert id", () => {
    insert("a", "1");
    insert("b", "2");

    const result = sync.execute(sync.kysely.updateTable("items").set({ amount: "3" }));

    expect(result).toStrictEqual({ numAffectedRows: 2n, rows: [] });
  });

  it("keeps a 64-bit row id past the safe integer range", () => {
    database.exec("INSERT INTO items (id, name, amount) VALUES (9223372036854775806, 'big', '1')");

    const result = sync.execute(
      sync.kysely.insertInto("items").values({ name: "next", amount: "2" }),
    );
    const rows = sync.execute(sync.kysely.selectFrom("items").select("name").orderBy("name")).rows;

    expect(result.insertId).toBe(9223372036854775807n);
    // node:sqlite rows have no prototype, so they compare by value.
    expect(rows).toEqual([{ name: "big" }, { name: "next" }]);
  });

  it("round-trips an amount above 2^64 as decimal text", () => {
    const amount = (2n ** 64n + 1n).toString();
    insert("whale", amount);

    const row = sync.takeFirst(sync.kysely.selectFrom("items").select("amount"));

    expect(row?.amount).toBe("18446744073709551617");
  });

  it("returns every row of a select, and the first row alone when asked", () => {
    insert("a", "1");
    insert("b", "2");
    const query = sync.kysely.selectFrom("items").select(["name", "amount"]).orderBy("id");

    expect(sync.execute(query).rows).toEqual([
      { name: "a", amount: "1" },
      { name: "b", amount: "2" },
    ]);
    expect(sync.takeFirst(query)).toEqual({ name: "a", amount: "1" });
    expect(sync.takeFirst(query.where("name", "=", "z"))).toBeUndefined();
  });

  it("refuses a value SQLite cannot bind", () => {
    const query = sync.kysely
      .selectFrom("items")
      .select("name")
      .where("name", "=", true as never);

    expect(() => sync.execute(query)).toThrow(
      expect.objectContaining({
        code: "store.bad_parameter",
        details: { index: 0, type: "boolean" },
      }),
    );
  });
});

describe("readRowsByIteration", () => {
  it("reads the same rows as all() and finishes the statement", () => {
    insert("a", "1");
    insert("b", "2");
    const statement = database.prepare("SELECT name FROM items WHERE id > ? ORDER BY id");

    expect(readRowsByIteration(statement, [0])).toStrictEqual(statement.all(0));
    expect(readRowsByIteration(statement, [1])).toStrictEqual(statement.all(1));
  });
});

describe("getNodeSqliteKysely", () => {
  it("compiles queries but refuses to run them itself", async () => {
    const kysely = getNodeSqliteKysely<Tables>();

    expect(kysely.selectFrom("items").select("name").compile().sql).toBe(
      'select "name" from "items"',
    );
    await expect(kysely.selectFrom("items").selectAll().execute()).rejects.toMatchObject({
      code: "store.compile_only",
    });
  });
});

function selectFirstName(): void {
  sync.execute(sync.kysely.selectFrom("items").select("name").where("id", "=", 1));
}

function selectNames(): void {
  sync.execute(sync.kysely.selectFrom("items").select("name"));
}

// A bound value past the cache's 64 KiB entry size.
function selectByLongName(): void {
  sync.execute(
    sync.kysely.selectFrom("items").select("name").where("name", "=", "x".repeat(70_000)),
  );
}

describe("the statement cache", () => {
  it("prepares SQL once it repeats, and only then reuses the statement", () => {
    const prepare = vi.spyOn(database, "prepare");
    selectFirstName();
    selectFirstName();
    selectFirstName();
    selectFirstName();

    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("keeps at most 64 statements", () => {
    const prepare = vi.spyOn(database, "prepare");
    const queries = Array.from(
      { length: 65 },
      (_, index) => () =>
        sync.execute(sync.kysely.selectFrom("items").select(`name as n${String(index)}` as "name")),
    );
    for (const run of queries) {
      run();
      run();
    }
    prepare.mockClear();

    for (const run of queries) {
      run();
    }

    // The oldest statement left when the 65th came in; the other 64 stay prepared.
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("prepares again after an authorizer changes, and never caches while one is set", () => {
    const prepare = vi.spyOn(database, "prepare");
    selectNames();
    selectNames();
    prepare.mockClear();

    database.setAuthorizer(() => 0);
    selectNames();
    selectNames();
    database.setAuthorizer(null);
    selectNames();

    expect(prepare).toHaveBeenCalledTimes(3);
  });

  it("does not keep statements whose bound text is large", () => {
    const prepare = vi.spyOn(database, "prepare");
    selectByLongName();
    selectByLongName();
    selectByLongName();

    expect(prepare).toHaveBeenCalledTimes(3);
  });

  it("closes with statements cached and refuses queries after", () => {
    insert("a", "1");
    insert("b", "2");

    database.close();

    expect(database.isOpen).toBe(false);
    expect(() => insert("c", "3")).toThrow(/not open/);
  });
});
