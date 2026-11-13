import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openConnection } from "../sqlite/open-connection.worker.js";
import { engineMigrations } from "./engine/engine-migrations.js";
import { runMigrations } from "./run-migrations.js";

const folders: string[] = [];
const connections: DatabaseSync[] = [];

afterEach(() => {
  for (const database of connections.splice(0)) {
    database.close();
  }
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  }
});

function connect(): DatabaseSync {
  const folder = mkdtempSync(join(tmpdir(), "bnf-breaker-"));
  folders.push(folder);
  const database = openConnection(join(folder, "engine.sqlite"), {
    role: "writer",
    synchronous: "full",
  });
  connections.push(database);
  return database;
}

const index = engineMigrations.findIndex((migration) => migration.name === "0066_breaker_mark");
const safety =
  "SELECT frozen_at, breaker_at, breaker_version, breaker_told, breaker_pulled_at FROM safety";

describe("the breaker mark migration", () => {
  it("leaves an install the breaker never held, and the owner's freeze, as they were", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations.slice(0, index) });
    database.prepare("UPDATE safety SET frozen_at = ? WHERE id = 1").run(4_000);

    runMigrations(database, { name: "engine", migrations: engineMigrations });

    expect(database.prepare(safety).get()).toEqual({
      frozen_at: 4_000,
      breaker_at: null,
      breaker_version: 0,
      breaker_told: 0,
      breaker_pulled_at: null,
    });
  });

  it("refuses a time or a version below zero", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations });
    const set = (column: string) => () =>
      database.prepare(`UPDATE safety SET ${column} = -1 WHERE id = 1`).run();
    expect(set("breaker_at")).toThrow(/CHECK/u);
    expect(set("breaker_version")).toThrow(/CHECK/u);
    expect(set("breaker_told")).toThrow(/CHECK/u);
    expect(set("breaker_pulled_at")).toThrow(/CHECK/u);
  });
});
