import type { DatabaseSync } from "node:sqlite";
import { idSchema } from "@binference/core";
import { afterAll, describe, expect, it } from "vitest";
import { agentDatabase } from "../databases/agent-database.js";
import { engineDatabase } from "../databases/engine-database.js";
import { createSqliteLedgerStore } from "../ledger/sqlite-ledger-store.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

const live = { signal: new AbortController().signal };
const hash = (digit: string): string => digit.repeat(64);

function engine(): DatabaseSync {
  return databases.open(engineDatabase).database;
}

function run(database: DatabaseSync, sql: string, ...values: (string | number | null)[]): void {
  database.prepare(sql).run(...values);
}

function plantIntent(database: DatabaseSync, id: string): void {
  const { agentId, walletId } = plantAgent(database, 1);
  run(
    database,
    `INSERT INTO intents (id, agent_id, wallet_id, kind, state, request, outside_content, paper,
      proposer, created_at, changed_at) VALUES (?, ?, ?, 'swap', 'proposed', '{}', 0, 1, 'engine', 1, 1)`,
    id,
    agentId,
    walletId,
  );
}

describe("the engine database's constraints", () => {
  it("keeps one safety row and refuses a second", () => {
    const database = engine();
    expect(database.prepare("SELECT id, version FROM safety").all()).toEqual([
      { id: 1, version: 0 },
    ]);
    expect(() => run(database, "INSERT INTO safety (id) VALUES (2)")).toThrow(/CHECK/);
  });

  it("refuses a value of the wrong type in a STRICT table", () => {
    const database = engine();
    expect(() => run(database, "INSERT INTO nonces VALUES ('fake:1:0xabc', 'seven', 1)")).toThrow(
      /cannot store TEXT value in INTEGER column/,
    );
  });

  it.each(["-1", "01", "1.5", "1e3", "", "9".repeat(79)])("refuses the amount %j", (amount) => {
    const database = engine();
    expect(() =>
      run(database, "INSERT INTO prices VALUES ('fake:1/token:a', 'quote', ?, 1)", amount),
    ).toThrow(/CHECK/);
  });

  it("keeps an amount beyond 64 bits as its exact decimal text", () => {
    const database = engine();
    const amount = (2n ** 64n + 1n).toString();
    run(database, "INSERT INTO prices VALUES ('fake:1/token:a', 'quote', ?, 1)", amount);
    expect(database.prepare("SELECT usd_micros FROM prices").get()).toEqual({
      usd_micros: "18446744073709551617",
    });
  });

  it("refuses a flag other than 0 or 1, text that is not JSON and a rate past 100%", () => {
    const database = engine();
    expect(() =>
      run(database, "INSERT INTO plugins VALUES ('plg_1', 'a', '1', 'core', 's', 'h', '[]', 2, 1)"),
    ).toThrow(/CHECK/);
    expect(() =>
      run(database, "INSERT INTO risk_cache VALUES ('fake:1/token:a', 'goplus', 'not json', 1)"),
    ).toThrow(/CHECK/);
    const { agentId } = plantAgent(database, 1);
    expect(() =>
      run(database, "INSERT INTO send_levels VALUES (?, 4, NULL, NULL, 1, 0)", agentId),
    ).toThrow(/CHECK/);
    expect(() =>
      run(database, "INSERT INTO prices VALUES ('fake:1/token:a', 'unknown source', '1', 1)"),
    ).toThrow(/CHECK/);
  });

  it("refuses a row whose parent is missing", () => {
    const database = engine();
    expect(() =>
      run(
        database,
        `INSERT INTO intents (id, agent_id, wallet_id, kind, state, request, outside_content,
          paper, proposer, created_at, changed_at)
          VALUES ('int_2', 'agt_none', 'wal_none', 'swap', 'proposed', '{}', 0, 1, 'engine', 1, 1)`,
      ),
    ).toThrow(/FOREIGN KEY/);
  });

  it("keeps one saved address per agent, chain and address until it is removed", () => {
    const database = engine();
    const { agentId } = plantAgent(database, 1);
    const save = (id: string): void =>
      run(
        database,
        "INSERT INTO address_book VALUES (?, ?, 'fake:1', '0xabc', 'cold', 1, NULL, 1, NULL)",
        id,
        agentId,
      );
    save("adr_1");
    expect(() => save("adr_2")).toThrow(/UNIQUE/);
    run(database, "UPDATE address_book SET removed_at = 5 WHERE id = 'adr_1'");
    expect(() => save("adr_2")).not.toThrow();
  });

  it("keeps one signed, sent, included or final transaction per account and nonce", () => {
    const database = engine();
    plantIntent(database, "int_1");
    const send = (id: string, state: string): void =>
      run(
        database,
        "INSERT INTO txs (id, intent_id, step, chain, account, nonce, state) VALUES (?, 'int_1', 0, 'fake:1', 'fake:1:0xabc', 7, ?)",
        id,
        state,
      );
    send("tx_1", "signed");
    expect(() => send("tx_2", "sent")).toThrow(/UNIQUE/);
    expect(() => send("tx_3", "dropped")).not.toThrow();
  });

  it("refuses a confirmation of a card version the intent never had", () => {
    const database = engine();
    plantIntent(database, "int_1");
    run(
      database,
      "INSERT INTO cards VALUES ('crd_1', 'int_1', 1, ?, NULL, 1, 2, NULL, NULL)",
      hash("a"),
    );
    const confirm = (version: number): void =>
      run(
        database,
        "INSERT INTO confirmations VALUES ('cnf_1', 'int_1', 'crd_1', ?, ?, 'telegram', '7', 1, 2)",
        version,
        hash("a"),
      );
    expect(() => confirm(2)).toThrow(/FOREIGN KEY/);
    expect(() => confirm(1)).not.toThrow();
  });

  it("refuses a ledger entry off the chain, and any change or removal", async () => {
    const { host, database } = databases.open(engineDatabase);
    const ledger = createSqliteLedgerStore(host);
    const id = idSchema("led").parse("led_0190f1c2-3a4b-7c5d-8e6f-000000000001");
    const first = await ledger.append({ id, atMs: 1, kind: "freeze", data: {} }, live);
    const insert = (seq: number, prevHash: string): void =>
      run(
        database,
        "INSERT INTO ledger VALUES (?, 'led_2', 2, NULL, 'freeze', NULL, '{}', ?, ?)",
        seq,
        prevHash,
        hash("b"),
      );
    expect(() => insert(3, first.hash)).toThrow(/next seq/);
    expect(() => insert(2, hash("c"))).toThrow(/next seq/);
    expect(() => run(database, "UPDATE ledger SET kind = 'unfreeze'")).toThrow(/append-only/);
    expect(() => run(database, "DELETE FROM ledger")).toThrow(/append-only/);
    expect(() => insert(2, first.hash)).not.toThrow();
  });
});

describe("the agent database's constraints", () => {
  it("keeps the notes index in step with every insert, change and removal", () => {
    const { database } = databases.open(agentDatabase);
    const search = (term: string): unknown[] =>
      database
        .prepare("SELECT rowid FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rowid")
        .all(term)
        .map((row) => row["rowid"]);
    run(
      database,
      "INSERT INTO notes (agent_id, text, origin, created_at, changed_at) VALUES ('agt_1', 'owner prefers stablecoins', 'owner', 1, 1)",
    );
    expect(search("stablecoins")).toStrictEqual([1]);
    run(database, "UPDATE notes SET text = 'owner prefers small trades' WHERE id = 1");
    expect([search("stablecoins"), search("small")]).toStrictEqual([[], [1]]);
    run(database, "DELETE FROM notes WHERE id = 1");
    expect(search("small")).toStrictEqual([]);
  });

  it("refuses a turn that ended without an outcome and a repeated transcript seq", () => {
    const { database } = databases.open(agentDatabase);
    run(
      database,
      "INSERT INTO sessions VALUES ('ses_1', 'agt_1', 'telegram', 'telegram:1:0', 1, NULL, NULL, 0)",
    );
    expect(() =>
      run(
        database,
        "INSERT INTO turns (id, session_id, started_at, ended_at) VALUES ('trn_1', 'ses_1', 1, 2)",
      ),
    ).toThrow(/CHECK/);
    const event = (): void =>
      run(
        database,
        "INSERT INTO transcript_events (session_id, seq, role, kind, content, at) VALUES ('ses_1', 1, 'owner', 'text', '\"hi\"', 1)",
      );
    event();
    expect(event).toThrow(/UNIQUE/);
  });
});
