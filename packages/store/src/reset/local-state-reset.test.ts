import type { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { agentDatabase } from "../databases/agent-database.js";
import type { AgentTables } from "../databases/agent-tables.js";
import { engineDatabase } from "../databases/engine-database.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { createIntent } from "../testing/create-intent.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createAgentStateReset, createEngineStateReset } from "./local-state-reset.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});
const options = { signal: new AbortController().signal };
const session = "ses_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const question = "qst_0190f1c2-3a4b-7c5d-8e6f-000000000001";

function countOf(database: DatabaseSync, table: keyof EngineTables | keyof AgentTables): number {
  const row = database.prepare(`SELECT count(*) AS n FROM ${table}`).get();
  return Number(row?.["n"]);
}

// An agent's chat traces and a cached risk report in engine.sqlite, beside one live intent.
function seedEngine(database: DatabaseSync, agentId: string): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(kysely.updateTable("agents").set({ chat_session_id: session }).where("id", "=", agentId));
  execute(
    kysely.insertInto("agent_inbox").values({
      id: "msg_0190f1c2-3a4b-7c5d-8e6f-000000000001",
      agent_id: agentId,
      session_id: session,
      kind: "inbox/message",
      turn_id: null,
      payload: JSON.stringify({ text: "buy the dip" }),
      created_at: 1,
      taken_at: null,
    }),
  );
  execute(
    kysely.insertInto("questions").values({
      id: question,
      agent_id: agentId,
      session_id: session,
      turn_id: turn,
      text: "How much?",
      choices: "[]",
      ref: "AAAAAAAAAAAAAAAA",
      state: "open",
      answer: null,
      close_reason: null,
      created_at: 1,
      closes_at: 2,
      closed_at: null,
    }),
  );
  execute(
    kysely.insertInto("question_messages").values({
      question_id: question,
      surface: "telegram",
      chat_id: 7,
      topic_id: null,
      message_id: 9,
      sent_at: 1,
    }),
  );
  execute(
    kysely
      .insertInto("risk_cache")
      .values({ asset: "fake:1/erc20:0x01", source: "goplus", result: "{}", fetched_at: 1 }),
  );
}

// One chat with a turn, an event and a queued message, and one note, in agent.sqlite.
function seedAgent(database: DatabaseSync, agentId: string): void {
  const { kysely, execute } = createSyncKysely<AgentTables>(database);
  execute(
    kysely.insertInto("sessions").values({
      id: session,
      agent_id: agentId,
      surface: "telegram",
      conversation: "telegram:7:",
      started_at: 1,
      cleared_at: null,
      summary: null,
    }),
  );
  execute(
    kysely.insertInto("turns").values({
      id: turn,
      session_id: session,
      started_at: 1,
      ended_at: 2,
      outcome: "ok",
      model: null,
    }),
  );
  execute(
    kysely.insertInto("transcript_events").values({
      session_id: session,
      turn_id: turn,
      seq: 1,
      role: "owner",
      kind: "text",
      content: JSON.stringify({ text: "buy the dip" }),
      at: 1,
    }),
  );
  execute(
    kysely.insertInto("chat_queue").values({
      message: "msg_2",
      agent_id: agentId,
      session_id: session,
      kind: "inbox/message",
      payload: "{}",
      received_at: 3,
      turn_id: null,
      dropped_at: null,
      drop_reason: null,
    }),
  );
  execute(
    kysely.insertInto("notes").values({
      agent_id: agentId,
      text: "owner likes BNB",
      origin: "owner",
      created_at: 1,
      changed_at: 1,
      deleted_at: null,
    }),
  );
}

describe("local state reset", () => {
  it("clears the chats, notes, inbox, questions and caches, and keeps money records", async () => {
    const engine = databases.open(engineDatabase);
    const agent = databases.open(agentDatabase);
    const planted = plantAgent(engine.database, 1);
    await createIntent(engine.host, planted, 1);
    seedEngine(engine.database, planted.agentId);
    seedAgent(agent.database, planted.agentId);

    await expect(createEngineStateReset(engine.host).clear(options)).resolves.toStrictEqual({
      inbox: 1,
      questions: 1,
      riskReports: 1,
      agents: 1,
    });
    await expect(createAgentStateReset(agent.host).clear(options)).resolves.toStrictEqual({
      sessions: 1,
      turns: 1,
      events: 1,
      queued: 1,
      notes: 1,
    });

    const engineLeft = ["question_messages", "agent_inbox", "risk_cache"] as const;
    expect(engineLeft.map((table) => countOf(engine.database, table))).toStrictEqual([0, 0, 0]);
    const agentLeft = ["sessions", "transcript_events", "notes", "notes_fts"] as const;
    expect(agentLeft.map((table) => countOf(agent.database, table))).toStrictEqual([0, 0, 0, 0]);
    const kept = ["intents", "wallets", "agents"] as const;
    expect(kept.map((table) => countOf(engine.database, table))).toStrictEqual([1, 1, 1]);
    const meta = agent.database
      .prepare("SELECT key, value FROM meta WHERE key != 'schema_version'")
      .all();
    expect(meta).toEqual([{ key: "writer_fence", value: "1" }]);
  });

  it("clears nothing on databases that hold no chat", async () => {
    const engine = createEngineStateReset(databases.open(engineDatabase).host);
    const agent = createAgentStateReset(databases.open(agentDatabase).host);
    await expect(engine.clear(options)).resolves.toStrictEqual({
      inbox: 0,
      questions: 0,
      riskReports: 0,
      agents: 0,
    });
    await expect(agent.clear(options)).resolves.toMatchObject({ events: 0, notes: 0 });
  });
});
