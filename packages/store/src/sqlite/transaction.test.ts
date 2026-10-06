import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConnection } from "./open-connection.worker.js";
import { readTransaction, writeTransaction } from "./transaction.js";

let folder = "";
let database: DatabaseSync;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "bnf-store-"));
  database = openConnection(join(folder, "test.sqlite"), { role: "writer", synchronous: "full" });
  database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
});

afterEach(() => {
  database.close();
  rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
});

function itemCount(): number {
  return Number(database.prepare("SELECT COUNT(*) AS count FROM items").get()?.["count"]);
}

describe("writeTransaction", () => {
  it("commits what the callback writes and returns its value", () => {
    const value = writeTransaction(database, () => {
      database.exec("INSERT INTO items (name) VALUES ('a')");
      return "done";
    });

    expect(value).toBe("done");
    expect(itemCount()).toBe(1);
    expect(database.isTransaction).toBe(false);
  });

  it("rolls everything back when the callback throws", () => {
    expect(() =>
      writeTransaction(database, () => {
        database.exec("INSERT INTO items (name) VALUES ('a')");
        throw new Error("refused");
      }),
    ).toThrow("refused");

    expect(itemCount()).toBe(0);
    expect(database.isTransaction).toBe(false);
  });

  it("refuses a callback that returns a promise and rolls its writes back", async () => {
    let pending: Promise<number> = Promise.resolve(0);

    expect(() =>
      writeTransaction(database, () => {
        database.exec("INSERT INTO items (name) VALUES ('a')");
        pending = Promise.resolve(1);
        return pending;
      }),
    ).toThrow(expect.objectContaining({ code: "store.async_transaction" }));

    await expect(pending).resolves.toBe(1);
    expect(itemCount()).toBe(0);
    expect(database.isTransaction).toBe(false);
  });

  it("rolls back when the commit itself fails", () => {
    database.exec("CREATE TABLE parents (id INTEGER PRIMARY KEY)");
    database.exec(
      "CREATE TABLE children (id INTEGER PRIMARY KEY, parent INTEGER REFERENCES parents (id) DEFERRABLE INITIALLY DEFERRED)",
    );

    expect(() =>
      writeTransaction(database, () => {
        database.exec("INSERT INTO children (parent) VALUES (42)");
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);

    expect(database.isTransaction).toBe(false);
    expect(database.prepare("SELECT COUNT(*) AS count FROM children").get()?.["count"]).toBe(0);
  });
});

describe("readTransaction", () => {
  it("returns what the callback reads and leaves no transaction open", () => {
    database.exec("INSERT INTO items (name) VALUES ('a'), ('b')");

    expect(readTransaction(database, itemCount)).toBe(2);
    expect(database.isTransaction).toBe(false);
  });
});
