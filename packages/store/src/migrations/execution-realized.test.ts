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
  const folder = mkdtempSync(join(tmpdir(), "bnf-realized-"));
  folders.push(folder);
  const database = openConnection(join(folder, "engine.sqlite"), {
    role: "writer",
    synchronous: "full",
  });
  connections.push(database);
  return database;
}

const index = engineMigrations.findIndex(
  (migration) => migration.name === "0017_execution_realized",
);

// An execution row as the tables before 0017 hold it, with a realized value when one is given.
function insertExecution(database: DatabaseSync, walletId: string, realized?: string): void {
  const columns = realized === undefined ? "" : ", realized_usd_micros";
  const values = realized === undefined ? "" : ", ?";
  database
    .prepare(
      `INSERT INTO executions (intent_id, wallet_id, asset_in, amount_in, fee_amount, asset_out,
        amount_out, gas_asset, gas_amount, value_usd_micros, fee_usd_micros, gas_usd_micros,
        paper, at${columns})
        VALUES ('int_1', ?, 'fake:1/slip44:1', '5', '0', 'fake:1/token:a', '7',
        'fake:1/slip44:1', '1', '3000000', '0', '1', 0, 1${values})`,
    )
    .run(walletId, ...(realized === undefined ? [] : [realized]));
}

function plantIntent(database: DatabaseSync): string {
  const { agentId, walletId } = plantAgent(database, 1);
  database
    .prepare(
      `INSERT INTO intents (id, agent_id, wallet_id, kind, state, request, outside_content,
        paper, proposer, created_at, changed_at)
        VALUES ('int_1', ?, ?, 'swap', 'reconciled', '{}', 0, 0, 'engine', 1, 1)`,
    )
    .run(agentId, walletId);
  return walletId;
}

describe("the execution realized migration", () => {
  it("gives an execution recorded before it a realized P&L of 0", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations.slice(0, index) });
    insertExecution(database, plantIntent(database));

    runMigrations(database, { name: "engine", migrations: engineMigrations });

    expect(
      database.prepare("SELECT realized_usd_micros AS realized FROM executions").all(),
    ).toEqual([{ realized: "0" }]);
  });

  it("keeps a signed decimal and refuses any other text", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations });
    const walletId = plantIntent(database);
    insertExecution(database, walletId, "-18446744073709551617");
    insertExecution(database, walletId, "42");
    for (const bad of ["-0", "007", "--1", "", "1.5", "-"]) {
      expect(() => {
        insertExecution(database, walletId, bad);
      }).toThrow(/CHECK constraint failed/u);
    }
  });
});
