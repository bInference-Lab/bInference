import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { busyTimeoutMs, openConnection, type ConnectionOptions } from "./open-connection.worker.js";

const folders: string[] = [];
const connections: DatabaseSync[] = [];

function open(options: ConnectionOptions, name = "test.sqlite"): DatabaseSync {
  const folder = folders[0] ?? mkdtempSync(join(tmpdir(), "bnf-store-"));
  if (folders.length === 0) {
    folders.push(folder);
  }
  const database = openConnection(join(folder, name), options);
  connections.push(database);
  return database;
}

afterEach(() => {
  for (const database of connections.splice(0)) {
    if (database.isOpen) {
      database.close();
    }
  }
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  }
});

function pragma(database: DatabaseSync, name: string): string {
  const row = database.prepare(`PRAGMA ${name}`).get() ?? {};
  return String(Object.values(row)[0]);
}

describe("openConnection", () => {
  it("opens the writer in WAL mode with foreign keys, the busy timeout and full sync", () => {
    const database = open({ role: "writer", synchronous: "full" });

    expect(pragma(database, "journal_mode")).toBe("wal");
    expect(pragma(database, "foreign_keys")).toBe("1");
    expect(pragma(database, "busy_timeout")).toBe(String(busyTimeoutMs));
    expect(pragma(database, "synchronous")).toBe("2");
    expect(pragma(database, "query_only")).toBe("0");
  });

  it("opens a reader that refuses to write", () => {
    const writer = open({ role: "writer", synchronous: "normal" });
    writer.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
    const reader = open({ role: "reader", synchronous: "normal" });

    expect(pragma(reader, "synchronous")).toBe("1");
    expect(pragma(reader, "query_only")).toBe("1");
    expect(() => reader.exec("INSERT INTO items DEFAULT VALUES")).toThrow(/readonly/);
  });

  it("names the file when its folder does not exist", () => {
    const missing = join(tmpdir(), "bnf-store-missing", "deeper", "engine.sqlite");

    expect(() => openConnection(missing, { role: "writer", synchronous: "full" })).toThrow(
      expect.objectContaining({ code: "store.open_failed", details: { file: missing } }),
    );
  });

  it("closes the file again when it is not a database", () => {
    const folder = mkdtempSync(join(tmpdir(), "bnf-store-"));
    folders.push(folder);
    const file = join(folder, "garbage.sqlite");
    writeFileSync(file, "this file holds text, not a SQLite database ".repeat(20));

    expect(() => openConnection(file, { role: "writer", synchronous: "full" })).toThrow(
      /not a database/,
    );
    rmSync(file);
  });
});
