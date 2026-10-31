import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Selectable } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { toLimitsRecord } from "../agents/limits-rows.js";
import type { EngineTables, LimitsTable } from "../databases/engine-tables.js";
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
  const folder = mkdtempSync(join(tmpdir(), "bnf-limits-"));
  folders.push(folder);
  const database = openConnection(join(folder, "engine.sqlite"), {
    role: "writer",
    synchronous: "full",
  });
  connections.push(database);
  return database;
}

const index = engineMigrations.findIndex(
  (migration) => migration.name === "0050_limits_without_health_factor",
);

// Every limit column as the tables before the migration held them, the health factor among them.
const columns = {
  per_trade_usd_micros: "100000000",
  rolling_day_usd_micros: "18446744073709551617",
  slippage_registry_bps: 100,
  slippage_other_bps: 500,
  price_impact_bps: 300,
  tax_bps: 1_000,
  liquidity_floor_usd_micros: "10000000000",
  min_health_factor_bp: 15_000,
  gas_reserve: JSON.stringify([{ chain: "eip155:56", reserveBase: "2000000000000000" }]),
  venues: JSON.stringify(["pancakeswap"]),
  allow_tokens: "[]",
  deny_tokens: "[]",
  model_budget_usd_micros: "3000000",
  card_trade_expiry_s: 60,
  card_other_expiry_s: 600,
  requote_after_s: 10,
  requote_tolerance_bps: 50,
  order_expiry_days: 30,
  copy_per_buy_usd_micros: "20000000",
  copy_per_leader_day_usd_micros: "100000000",
};

function plantLimits(database: DatabaseSync, agentId: string, pending: string | null): void {
  const values = { agent_id: agentId, ...columns, changed_at: 5, version: 2 };
  const all = { ...values, pending, pending_at: pending === null ? null : 9 };
  const names = Object.keys(all);
  database
    .prepare(`INSERT INTO limits (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
    .run(...Object.values(all));
}

function limitsRows(database: DatabaseSync): readonly Selectable<LimitsTable>[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  return execute(kysely.selectFrom("limits").selectAll().orderBy("agent_id")).rows;
}

describe("the limits without health factor migration", () => {
  it("drops the health factor from the limits in effect and the looser ones that wait", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations.slice(0, index) });
    const waiting = plantAgent(database, 1).agentId;
    const settled = plantAgent(database, 2).agentId;
    plantLimits(database, waiting, JSON.stringify({ ...columns, min_health_factor_bp: 12_000 }));
    plantLimits(database, settled, null);

    runMigrations(database, { name: "engine", migrations: engineMigrations });

    const { min_health_factor_bp: _gone, ...kept } = columns;
    const rows = limitsRows(database);
    expect(rows.map((row) => Object.keys(row))).toStrictEqual([
      expect.not.arrayContaining(["min_health_factor_bp"]),
      expect.not.arrayContaining(["min_health_factor_bp"]),
    ]);
    expect(rows.map((row) => row.pending)).toStrictEqual([JSON.stringify(kept), null]);
    const records = rows.map(toLimitsRecord);
    expect(records.map((record) => record.pending?.atMs)).toStrictEqual([9, undefined]);
    expect(records.map((record) => record.rollingDayUsdMicros)).toStrictEqual([
      2n ** 64n + 1n,
      2n ** 64n + 1n,
    ]);
  });
});
