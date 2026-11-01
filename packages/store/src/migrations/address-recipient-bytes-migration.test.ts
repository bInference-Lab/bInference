import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
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
  const folder = mkdtempSync(join(tmpdir(), "bnf-bytes-"));
  folders.push(folder);
  const database = openConnection(join(folder, "engine.sqlite"), {
    role: "writer",
    synchronous: "full",
  });
  connections.push(database);
  return database;
}

const index = engineMigrations.findIndex(
  (migration) => migration.name === "0052_address_recipient_bytes",
);

const checksummed = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

function rows(database: DatabaseSync): readonly (readonly unknown[])[] {
  const query = database.prepare("SELECT address, recipient_bytes FROM address_book ORDER BY id");
  return query.all().map((row) => [row["address"], row["recipient_bytes"]]);
}

describe("the recipient bytes migration", () => {
  it("keeps every saved address, and gives each its hex in lowercase as its bytes", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations.slice(0, index) });
    const { agentId } = plantAgent(database, 1);
    database
      .prepare(
        "INSERT INTO address_book VALUES ('adr_1', ?, 'eip155:56', ?, 'cold', 1, 1, 1, NULL)",
      )
      .run(agentId, checksummed);

    runMigrations(database, { name: "engine", migrations: engineMigrations });

    expect(rows(database)).toStrictEqual([[checksummed, checksummed.toLowerCase()]]);
  });

  it("takes only lowercase hex after 0x as an entry's bytes", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations });
    const { agentId } = plantAgent(database, 1);
    const insert = (id: string, bytes: string) =>
      database
        .prepare("INSERT INTO address_book VALUES (?, ?, 'eip155:56', ?, 'cold', 1, 1, 1, NULL, ?)")
        .run(id, agentId, `0x${id}`, bytes);

    insert("adr_ok", checksummed.toLowerCase());
    for (const bytes of ["", "0x", checksummed, "0xabc", "ab12"]) {
      expect(() => insert(`adr_${bytes.length}`, bytes)).toThrow(/CHECK constraint/);
    }
    expect(rows(database)).toHaveLength(1);
  });
});
