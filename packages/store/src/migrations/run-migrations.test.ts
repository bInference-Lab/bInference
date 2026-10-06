import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { checkIntegrity } from "../sqlite/integrity-check.js";
import { openConnection } from "../sqlite/open-connection.worker.js";
import { agentMigrations } from "./agent/agent-migrations.js";
import { engineMigrations } from "./engine/engine-migrations.js";
import type { Migration } from "./migration.js";
import { assertKnownVersion, latestVersion, runMigrations } from "./run-migrations.js";
import { readSchemaVersion, writeSchemaVersion } from "./schema-version.js";

const folders: string[] = [];
const connections: DatabaseSync[] = [];

function connect(): DatabaseSync {
  const folder = mkdtempSync(join(tmpdir(), "bnf-store-"));
  folders.push(folder);
  const database = openConnection(join(folder, "test.sqlite"), {
    role: "writer",
    synchronous: "normal",
  });
  connections.push(database);
  return database;
}

afterEach(() => {
  for (const database of connections.splice(0)) {
    database.close();
  }
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  }
});

function tableNames(database: DatabaseSync): string[] {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row["name"]));
}

const meta = engineMigrations[0] as Migration;

const notes: Migration = {
  name: "0002_notes",
  up(database) {
    database.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL)");
  },
};

const failsAfterWork: Migration = {
  name: "0003_positions",
  up(database) {
    database.exec("CREATE TABLE positions (id INTEGER PRIMARY KEY, asset TEXT NOT NULL)");
    database.exec("INSERT INTO positions (asset) VALUES ('BNB')");
    database.exec("INSERT INTO notes (text) VALUES ('written by a failing migration')");
    throw new Error("the migration found data it cannot convert");
  },
};

const badSql: Migration = {
  name: "0003_positions",
  up(database) {
    database.exec("CREATE TABLE positions (id INTEGER PRIMARY KEY, asset TEXT NOT NULL)");
    database.exec("INSERT INTO missing_table (x) VALUES (1)");
  },
};

describe("runMigrations", () => {
  it("migrates an empty database to the newest version, then applies nothing more", () => {
    const database = connect();

    const first = runMigrations(database, { name: "test", migrations: [meta, notes] });
    const second = runMigrations(database, { name: "test", migrations: [meta, notes] });

    expect(first).toStrictEqual({ from: 0, to: 2, applied: ["0001_meta", "0002_notes"] });
    expect(second).toStrictEqual({ from: 2, to: 2, applied: [] });
    expect(tableNames(database)).toStrictEqual(["meta", "notes"]);
  });

  it("rolls a failing migration back whole and keeps the migrations before it", () => {
    const database = connect();
    runMigrations(database, { name: "test", migrations: [meta, notes] });

    expect(() =>
      runMigrations(database, { name: "test", migrations: [meta, notes, failsAfterWork] }),
    ).toThrow(
      expect.objectContaining({
        code: "store.migration_failed",
        details: {
          migration: "0003_positions",
          schemaVersion: 2,
          reason: "the migration found data it cannot convert",
        },
      }),
    );
    expect(readSchemaVersion(database)).toBe(2);
    expect(tableNames(database)).toStrictEqual(["meta", "notes"]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM notes").get()?.["count"]).toBe(0);
    expect(checkIntegrity(database, 2).ok).toBe(true);
  });

  it("rolls back a migration whose SQL fails, with SQLite's reason", () => {
    const database = connect();

    expect(() =>
      runMigrations(database, { name: "test", migrations: [meta, notes, badSql] }),
    ).toThrow(
      expect.objectContaining({
        code: "store.migration_failed",
        details: {
          migration: "0003_positions",
          schemaVersion: 2,
          reason: "no such table: missing_table",
        },
      }),
    );
    expect(readSchemaVersion(database)).toBe(2);
    expect(tableNames(database)).toStrictEqual(["meta", "notes"]);
  });

  it("refuses a database whose schema is newer than its migrations", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: [meta] });
    writeSchemaVersion(database, 7);

    expect(() => runMigrations(database, { name: "engine", migrations: [meta] })).toThrow(
      expect.objectContaining({
        code: "store.newer_schema",
        details: { database: "engine", schemaVersion: 7, supportedVersion: 1 },
      }),
    );
    expect(tableNames(database)).toStrictEqual(["meta"]);
  });

  it("refuses a schema version that is not a number", () => {
    const database = connect();
    runMigrations(database, { name: "test", migrations: [meta] });
    database.exec("UPDATE meta SET value = 'seven' WHERE key = 'schema_version'");

    expect(() => readSchemaVersion(database)).toThrow(
      expect.objectContaining({ code: "store.bad_schema_version" }),
    );
  });
});

describe("latestVersion", () => {
  it("is the number of migrations numbered from 0001 with no gap", () => {
    expect(latestVersion([])).toBe(0);
    expect(latestVersion([meta, notes])).toBe(2);
  });

  it.each([
    ["a gap", [meta, { ...notes, name: "0003_notes" }]],
    ["a wrong order", [notes, meta]],
    ["a name that is not NNNN_name", [meta, { ...notes, name: "0002-notes" }]],
    ["a repeated number", [meta, { ...notes, name: "0001_notes" }]],
  ])("refuses %s", (_, migrations) => {
    expect(() => latestVersion(migrations)).toThrow(
      expect.objectContaining({ code: "store.migration_order" }),
    );
  });
});

describe("assertKnownVersion", () => {
  it("accepts the newest version and older ones", () => {
    expect(() => {
      assertKnownVersion("engine", 3, 3);
      assertKnownVersion("engine", 0, 3);
    }).not.toThrow();
  });
});

describe("the migration lists", () => {
  it.each([
    ["engine", engineMigrations],
    ["agent", agentMigrations],
  ])("list every %s migration file in order", (database, migrations) => {
    const folder = join(import.meta.dirname, database);
    const files = readdirSync(folder)
      .filter((file) => /^\d{4}_[a-z0-9_]+\.ts$/.test(file))
      .toSorted()
      .map((file) => file.replace(/\.ts$/, ""));

    expect(migrations.map((migration) => migration.name)).toStrictEqual(files);
    expect(latestVersion(migrations)).toBe(files.length);
  });
});
