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
  const folder = mkdtempSync(join(tmpdir(), "bnf-alerts-"));
  folders.push(folder);
  const database = openConnection(join(folder, "engine.sqlite"), {
    role: "writer",
    synchronous: "full",
  });
  connections.push(database);
  return database;
}

const index = engineMigrations.findIndex((migration) => migration.name === "0041_alert_fires");
const toldIndex = engineMigrations.findIndex(
  (migration) => migration.name === "0048_alert_fires_told",
);
const alertId = "alr_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const condition = JSON.stringify({
  kind: "price",
  asset: "eip155:56/slip44:714",
  direction: "above",
  price: "18446744073709551617",
});

const walletId = "alr_0190f1c2-3a4b-7c5d-8e6f-000000000002";
const walletCondition = JSON.stringify({
  kind: "wallet",
  account: "eip155:56:0x0000000000000000000000000000000000000001",
});
const launchId = "alr_0190f1c2-3a4b-7c5d-8e6f-000000000003";
const launchCondition = JSON.stringify({ kind: "launch", filters: { maxInsiders: 2 } });
const thirtyDaysMs = 2_592_000_000;

// The columns a migrated row keeps the same whatever its kind.
const carried = {
  wake: 0,
  outside_content: 1,
  created_by: "unknown",
  last_message_id: null,
  notice_window_at: null,
  notices_sent: 0,
  notices_held: 0,
};

describe("the alert fires migration", () => {
  it("keeps the alerts stored before it, marked, with no wake-up, each kind's columns filled", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations.slice(0, index) });
    const { agentId } = plantAgent(database, 1);
    const insert = database.prepare(
      "INSERT INTO alerts (id, agent_id, condition, state, created_at, fired_at) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    );
    insert.run(alertId, agentId, condition, "fired", 5, 9);
    insert.run(walletId, agentId, walletCondition, "active", 6, null);
    insert.run(launchId, agentId, launchCondition, "deleted", 7, 8);

    runMigrations(database, { name: "engine", migrations: engineMigrations });

    expect(database.prepare("SELECT * FROM alerts ORDER BY created_at").all()).toEqual([
      {
        ...carried,
        id: alertId,
        agent_id: agentId,
        condition,
        kind: "price",
        account: null,
        asset: "eip155:56/slip44:714",
        state: "fired",
        fires: 1,
        created_at: 5,
        changed_at: 9,
        fired_at: 9,
        expires_at: null,
      },
      {
        ...carried,
        id: walletId,
        agent_id: agentId,
        condition: walletCondition,
        kind: "wallet",
        account: "eip155:56:0x0000000000000000000000000000000000000001",
        asset: null,
        state: "active",
        fires: 0,
        created_at: 6,
        changed_at: 6,
        fired_at: null,
        expires_at: 6 + thirtyDaysMs,
      },
      {
        ...carried,
        id: launchId,
        agent_id: agentId,
        condition: launchCondition,
        kind: "launch",
        account: null,
        asset: null,
        state: "deleted",
        fires: 1,
        created_at: 7,
        changed_at: 8,
        fired_at: 8,
        expires_at: 7 + thirtyDaysMs,
      },
    ]);
  });

  it("refuses a wallet alert with no account, as the check holds", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations });
    const { agentId } = plantAgent(database, 1);
    const insert = database.prepare(
      "INSERT INTO alerts (id, agent_id, condition, kind, state, created_by, created_at, " +
        "changed_at) VALUES (?, ?, ?, 'wallet', 'active', 'cli', 1, 1)",
    );

    expect(() => insert.run(walletId, agentId, walletCondition)).toThrow(/CHECK constraint/);
  });

  it("counts as told each held wake-up before its agent's last wake-up, and no later one", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations.slice(0, toldIndex) });
    const { agentId } = plantAgent(database, 1);
    database
      .prepare(
        "INSERT INTO alerts (id, agent_id, condition, kind, state, created_by, created_at, " +
          "changed_at) VALUES (?, ?, ?, 'launch', 'active', 'cli', 1, 1)",
      )
      .run(launchId, agentId, launchCondition);
    const fire = database.prepare(
      "INSERT INTO alert_fires (alert_id, fires, agent_id, at, outcome, reason, message_id) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    fire.run(launchId, 1, agentId, 10, "skipped", "hourly", null);
    fire.run(launchId, 2, agentId, 20, "woke", null, "msg_0190f1c2-3a4b-7c5d-8e6f-000000000001");
    fire.run(launchId, 3, agentId, 30, "skipped", "hourly", null);

    runMigrations(database, { name: "engine", migrations: engineMigrations });

    expect(database.prepare("SELECT fires, told FROM alert_fires ORDER BY fires").all()).toEqual([
      { fires: 1, told: 1 },
      { fires: 2, told: 0 },
      { fires: 3, told: 0 },
    ]);
  });
});
