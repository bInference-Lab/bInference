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
  const folder = mkdtempSync(join(tmpdir(), "bnf-positions-"));
  folders.push(folder);
  const database = openConnection(join(folder, "engine.sqlite"), {
    role: "writer",
    synchronous: "full",
  });
  connections.push(database);
  return database;
}

const index = engineMigrations.findIndex(
  (migration) => migration.name === "0015_positions_and_departures",
);
const before = { name: "engine", migrations: engineMigrations.slice(0, index) };
const all = { name: "engine", migrations: engineMigrations };

describe("the positions and departures migration", () => {
  it("makes executions again in the execution record's shape when it holds no row", () => {
    const database = connect();
    runMigrations(database, before);

    runMigrations(database, all);

    const columns = database
      .prepare("SELECT name FROM pragma_table_info('executions') ORDER BY cid")
      .all()
      .map((row) => row["name"]);
    expect(columns).toContain("fee_amount");
    expect(columns).not.toContain("price_usd_micros");
  });

  it("stops, changing nothing, when executions holds a row the rebuild would lose", () => {
    const database = connect();
    runMigrations(database, before);
    const { agentId, walletId } = plantAgent(database, 1);
    database
      .prepare(
        `INSERT INTO intents (id, agent_id, wallet_id, kind, state, request, outside_content,
          paper, proposer, created_at, changed_at)
          VALUES ('int_1', ?, ?, 'swap', 'reconciled', '{}', 0, 0, 'engine', 1, 1)`,
      )
      .run(agentId, walletId);
    database
      .prepare(
        `INSERT INTO executions (intent_id, wallet_id, asset_in, amount_in, asset_out, amount_out,
          price_usd_micros, fee_usd_micros, gas_usd_micros, paper, at)
          VALUES ('int_1', ?, 'fake:1/slip44:1', '5', 'fake:1/token:a', '7', '1', '0', '0', 0, 1)`,
      )
      .run(walletId);

    expect(() => runMigrations(database, all)).toThrow(
      expect.objectContaining({ code: "store.migration_failed" }),
    );
    expect(database.prepare("SELECT count(*) AS held FROM executions").get()).toEqual({ held: 1 });
    expect(
      database.prepare("SELECT count(*) AS made FROM sqlite_schema WHERE name = 'arrivals'").get(),
    ).toEqual({ made: 0 });
  });
});
