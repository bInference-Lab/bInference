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
  const folder = mkdtempSync(join(tmpdir(), "bnf-tracked-"));
  folders.push(folder);
  const database = openConnection(join(folder, "engine.sqlite"), {
    role: "writer",
    synchronous: "full",
  });
  connections.push(database);
  return database;
}

const index = engineMigrations.findIndex(({ name }) => name === "0042_tracked_wallets");
const accountOf = (n: number): string => `eip155:56:0x${n.toString(16).padStart(40, "0")}`;

describe("the tracked wallets migration", () => {
  it("tracks each account of an active wallet alert of an agent in use, from its first alert", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations.slice(0, index) });
    const live = plantAgent(database, 1).agentId;
    const archived = plantAgent(database, 2).agentId;
    database.prepare("UPDATE agents SET archived_at = 3 WHERE id = ?").run(archived);
    const insert = database.prepare(
      "INSERT INTO alerts (id, agent_id, condition, kind, account, state, created_by, " +
        "created_at, changed_at) VALUES (?, ?, ?, 'wallet', ?, ?, 'cli', ?, ?)",
    );
    const rows = [
      [1, live, 1, "active", 7],
      [2, live, 1, "active", 5],
      [3, live, 2, "deleted", 4],
      [4, archived, 3, "active", 6],
    ] as const;
    for (const [n, agent, wallet, state, at] of rows) {
      const id = `alr_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`;
      const condition = JSON.stringify({ kind: "wallet", account: accountOf(wallet) });
      insert.run(id, agent, condition, accountOf(wallet), state, at, at);
    }

    runMigrations(database, { name: "engine", migrations: engineMigrations });

    expect(database.prepare("SELECT * FROM tracked_wallets").all()).toEqual([
      {
        account: accountOf(1),
        since_block: null,
        last_block: null,
        overflow_blocks: 0,
        added_at: 5,
        untracked_at: null,
      },
    ]);
  });

  it("refuses a trade amount that is not decimal digits", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations });
    const insert = database.prepare(
      "INSERT INTO wallet_activity (account, block, tx_hash, log_index, side, asset, amount, " +
        "counter_asset, counter_amount, at) VALUES ('a', '1', '0x1', 0, 'buy', 'b', ?, 'c', '1', 1)",
    );
    expect(() => insert.run("-1")).toThrow(/CHECK constraint/);
    expect(() => insert.run("18446744073709551617")).not.toThrow();
    expect(() => insert.run("18446744073709551617")).toThrow(/UNIQUE constraint/);
  });
});
