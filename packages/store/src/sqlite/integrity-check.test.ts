import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { engineMigrations } from "../migrations/engine/engine-migrations.js";
import { runMigrations } from "../migrations/run-migrations.js";
import { checkIntegrity } from "./integrity-check.js";
import { integrityReportSchema } from "./integrity-report.js";
import { openConnection } from "./open-connection.worker.js";

let folder = "";
let database: DatabaseSync;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "bnf-store-"));
  database = openConnection(join(folder, "engine.sqlite"), { role: "writer", synchronous: "full" });
  runMigrations(database, { name: "engine", migrations: engineMigrations });
});

afterEach(() => {
  database.close();
  rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
});

describe("checkIntegrity", () => {
  it("reports a clean, current database as ok", () => {
    const report = checkIntegrity(database, 1);

    expect(report).toStrictEqual({
      ok: true,
      integrity: ["ok"],
      foreignKeys: [],
      schemaVersion: 1,
      expectedVersion: 1,
      pageCount: report.pageCount,
      freePages: 0,
    });
    expect(report.pageCount).toBeGreaterThan(0);
    expect(integrityReportSchema.parse(report)).toStrictEqual(report);
  });

  it("reports a row whose parent is missing", () => {
    database.exec("CREATE TABLE wallets (id TEXT PRIMARY KEY)");
    database.exec("CREATE TABLE ceilings (wallet_id TEXT REFERENCES wallets (id))");
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec("INSERT INTO ceilings (wallet_id) VALUES ('wal_missing')");
    database.exec("PRAGMA foreign_keys = ON");

    const report = checkIntegrity(database, 1);

    expect(report.ok).toBe(false);
    expect(report.integrity).toStrictEqual(["ok"]);
    expect(report.foreignKeys).toStrictEqual([{ table: "ceilings", rowid: 1, parent: "wallets" }]);
  });

  it("reports a schema version other than the expected one", () => {
    const report = checkIntegrity(database, 3);

    expect(report.ok).toBe(false);
    expect(report).toMatchObject({ schemaVersion: 1, expectedVersion: 3 });
  });

  it("counts free pages left by deleted rows", () => {
    database.exec("CREATE TABLE blobs (data BLOB)");
    database.exec(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 64) INSERT INTO blobs SELECT randomblob(4096) FROM n",
    );
    database.exec("DELETE FROM blobs");

    expect(checkIntegrity(database, 1).freePages).toBeGreaterThan(0);
  });
});
