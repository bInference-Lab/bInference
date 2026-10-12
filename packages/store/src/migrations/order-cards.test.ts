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
  const folder = mkdtempSync(join(tmpdir(), "bnf-order-cards-"));
  folders.push(folder);
  const database = openConnection(join(folder, "engine.sqlite"), {
    role: "writer",
    synchronous: "full",
  });
  connections.push(database);
  return database;
}

const index = engineMigrations.findIndex((migration) => migration.name === "0031_order_cards");
const orderId = "ord_0190f1c2-3a4b-7c5d-8e6f-000000000001";

// An active order with one skipped fill, as the tables before 0031 could hold one.
function insertOrder(database: DatabaseSync): void {
  const { agentId, walletId } = plantAgent(database, 1);
  database
    .prepare(
      `INSERT INTO orders (id, agent_id, wallet_id, kind, state, request, fills, created_at,
        changed_at) VALUES (?, ?, ?, 'limit', 'active', '{}', 0, 5, 6)`,
    )
    .run(orderId, agentId, walletId);
  database
    .prepare(
      `INSERT INTO order_fills (id, order_id, outcome, reason, at)
        VALUES ('fil_1', ?, 'skipped', 'daily_cap', 7)`,
    )
    .run(orderId);
}

describe("the order cards migration", () => {
  it("keeps an order stored before it as cancelled, with its fills", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations.slice(0, index) });
    insertOrder(database);

    runMigrations(database, { name: "engine", migrations: engineMigrations });

    expect(
      database
        .prepare(
          `SELECT state, intent_id AS intent, expires_at AS expires, paper,
            outside_content AS outside FROM orders`,
        )
        .all(),
    ).toEqual([
      {
        state: "cancelled",
        intent: "int_0190f1c2-3a4b-7c5d-8e6f-000000000001",
        expires: 5,
        paper: 0,
        outside: 1,
      },
    ]);
    expect(database.prepare("SELECT id, order_id AS 'order' FROM order_fills").all()).toEqual([
      { id: "fil_1", order: orderId },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("refuses an active order without the card that confirmed it", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations });
    const { agentId, walletId } = plantAgent(database, 1);
    const insert = database.prepare(
      `INSERT INTO orders (id, agent_id, wallet_id, kind, state, request, expires_at, intent_id,
        paper, outside_content, created_at, changed_at) VALUES (?, ?, ?, 'limit', 'active', '{}',
        9, 'int_1', 1, 0, 1, 1)`,
    );

    expect(() => insert.run(orderId, agentId, walletId)).toThrow(/CHECK constraint failed/);
  });
});
