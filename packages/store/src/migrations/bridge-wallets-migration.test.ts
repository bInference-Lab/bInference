import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { openConnection } from "../sqlite/open-connection.worker.js";
import { plantAgent } from "../testing/plant-agent.js";
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
  const folder = mkdtempSync(join(tmpdir(), "bnf-roles-"));
  folders.push(folder);
  const database = openConnection(join(folder, "engine.sqlite"), {
    role: "writer",
    synchronous: "full",
  });
  connections.push(database);
  return database;
}

const index = engineMigrations.findIndex((migration) => migration.name === "0051_bridge_wallets");

function setRole(database: DatabaseSync, wallet: string, role: string): void {
  database.prepare("UPDATE wallets SET role = ? WHERE id = ?").run(role, wallet);
}

function roles(database: DatabaseSync): readonly (readonly [string, string])[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const query = kysely.selectFrom("wallets").select(["id", "role"]).orderBy("id");
  return execute(query).rows.map((row) => [row.id, row.role] as const);
}

describe("the bridge wallets migration", () => {
  it("keeps every stored role, and lets a wallet hold the bridge role", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations.slice(0, index) });
    const main = plantAgent(database, 1).walletId;
    const launch = plantAgent(database, 2).walletId;
    setRole(database, launch, "launch");
    expect(() => {
      setRole(database, main, "bridge");
    }).toThrow(/CHECK constraint/);

    runMigrations(database, { name: "engine", migrations: engineMigrations });
    expect(roles(database)).toStrictEqual([
      [main, "agent"],
      [launch, "launch"],
    ]);
    setRole(database, main, "bridge");

    expect(roles(database)).toStrictEqual([
      [main, "bridge"],
      [launch, "launch"],
    ]);
    expect(() => {
      setRole(database, main, "other");
    }).toThrow(/CHECK constraint/);
  });
});
