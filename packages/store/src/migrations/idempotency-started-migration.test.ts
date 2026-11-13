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
  const folder = mkdtempSync(join(tmpdir(), "bnf-idempotency-"));
  folders.push(folder);
  const database = openConnection(join(folder, "engine.sqlite"), {
    role: "writer",
    synchronous: "full",
  });
  connections.push(database);
  return database;
}

const index = engineMigrations.findIndex(
  (migration) => migration.name === "0065_idempotency_started",
);
const argsHash = "a".repeat(64);
const insert =
  "INSERT INTO idempotency (credential, op, key, args_hash, result, at) VALUES (?, ?, ?, ?, ?, ?)";

describe("the idempotency started migration", () => {
  it("keeps every result stored before it", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations.slice(0, index) });
    database.prepare(insert).run("tok_1", "intent/propose", "k1", argsHash, '{"intent":1}', 5);
    database.prepare(insert).run("dev_2", "order/create", "k2", argsHash, "[]", 9);

    runMigrations(database, { name: "engine", migrations: engineMigrations });

    expect(database.prepare("SELECT * FROM idempotency ORDER BY at").all()).toEqual([
      {
        credential: "tok_1",
        op: "intent/propose",
        key: "k1",
        args_hash: argsHash,
        result: '{"intent":1}',
        at: 5,
      },
      {
        credential: "dev_2",
        op: "order/create",
        key: "k2",
        args_hash: argsHash,
        result: "[]",
        at: 9,
      },
    ]);
  });

  it("takes a started key with no result and still refuses a result that is not JSON", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations });
    database.prepare(insert).run("tok_1", "intent/propose", "k1", argsHash, null, 5);

    expect(() =>
      database.prepare(insert).run("tok_1", "intent/propose", "k2", argsHash, "not json", 5),
    ).toThrow(/CHECK constraint/);
    expect(() =>
      database.prepare(insert).run("tok_1", "intent/propose", "k1", argsHash, null, 6),
    ).toThrow(/UNIQUE constraint/);
  });
});
