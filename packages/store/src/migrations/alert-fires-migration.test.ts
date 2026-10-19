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
const alertId = "alr_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const condition = JSON.stringify({
  kind: "price",
  asset: "eip155:56/slip44:714",
  direction: "above",
  price: "18446744073709551617",
});

describe("the alert fires migration", () => {
  it("keeps an alert stored before it, marked, with no wake-up and its one fire", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations.slice(0, index) });
    const { agentId } = plantAgent(database, 1);
    database
      .prepare(
        "INSERT INTO alerts (id, agent_id, condition, state, created_at, fired_at) " +
          "VALUES (?, ?, ?, 'fired', 5, 9)",
      )
      .run(alertId, agentId, condition);

    runMigrations(database, { name: "engine", migrations: engineMigrations });

    expect(database.prepare("SELECT * FROM alerts").all()).toEqual([
      {
        id: alertId,
        agent_id: agentId,
        condition,
        kind: "price",
        account: null,
        state: "fired",
        wake: 0,
        fires: 1,
        outside_content: 1,
        created_by: "unknown",
        created_at: 5,
        changed_at: 9,
        fired_at: 9,
        expires_at: null,
        last_message_id: null,
      },
    ]);
  });
});
