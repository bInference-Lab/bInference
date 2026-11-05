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
  const folder = mkdtempSync(join(tmpdir(), "bnf-write-order-"));
  folders.push(folder);
  const database = openConnection(join(folder, "engine.sqlite"), {
    role: "writer",
    synchronous: "full",
  });
  connections.push(database);
  return database;
}

// The engine database at the schema before the migration named.
function engineBefore(name: string): DatabaseSync {
  const database = connect();
  const index = engineMigrations.findIndex((migration) => migration.name === name);
  runMigrations(database, { name: "engine", migrations: engineMigrations.slice(0, index) });
  return database;
}

const orderId = "ord_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const fillId = (n: number): string =>
  `fil_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`;

// A cancelled order of a planted agent, whose fill rows the tests write.
function insertOrder(database: DatabaseSync): void {
  const { agentId, walletId } = plantAgent(database, 1);
  database
    .prepare(
      `INSERT INTO orders (id, agent_id, wallet_id, kind, state, request, expires_at, intent_id,
        paper, outside_content, created_at, changed_at)
        VALUES (?, ?, ?, 'limit', 'cancelled', '{}', 9, 'int_1', 1, 0, 1, 1)`,
    )
    .run(orderId, agentId, walletId);
}

function insertFills(database: DatabaseSync, rows: readonly (readonly [number, number])[]): void {
  const insert = database.prepare(
    `INSERT INTO order_fills (id, order_id, outcome, reason, at)
      VALUES (?, ?, 'skipped', 'daily_cap', ?)`,
  );
  for (const [n, at] of rows) {
    insert.run(fillId(n), orderId, at);
  }
}

const seqs = (database: DatabaseSync, table: string, key: string) =>
  database.prepare(`SELECT ${key} AS key, seq FROM ${table} ORDER BY seq`).all();

describe("the order fill write-order migration", () => {
  it("numbers the rows as the store read them, then each new row after the last", () => {
    const database = engineBefore("0060_order_fill_seq");
    insertOrder(database);
    // Ids that sort against the order the rows were written in, two of one instant.
    insertFills(database, [
      [9, 5],
      [8, 3],
      [7, 5],
    ]);

    runMigrations(database, { name: "engine", migrations: engineMigrations });
    insertFills(database, [[1, 4]]);

    expect(seqs(database, "order_fills", "id")).toEqual([
      { key: fillId(8), seq: 1 },
      { key: fillId(9), seq: 2 },
      { key: fillId(7), seq: 3 },
      { key: fillId(1), seq: 4 },
    ]);
  });

  it("starts the count at the first row of an empty table and never takes a number twice", () => {
    const database = engineBefore("0060_order_fill_seq");
    insertOrder(database);
    runMigrations(database, { name: "engine", migrations: engineMigrations });

    insertFills(database, [[1, 4]]);
    database.prepare("DELETE FROM order_fills").run();
    insertFills(database, [[2, 4]]);

    expect(seqs(database, "order_fills", "id")).toEqual([{ key: fillId(2), seq: 2 }]);
  });
});
