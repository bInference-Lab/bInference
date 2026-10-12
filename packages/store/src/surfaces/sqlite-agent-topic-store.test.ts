import { type Id, idSchema } from "@binference/core";
import { agentTopicStoreContract, testAgentDraft } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteAgentStore } from "../agents/sqlite-agent-store.js";
import { engineDatabase } from "../databases/engine-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteAgentTopicStore } from "./sqlite-agent-topic-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

const live = { signal: new AbortController().signal };

// A topic store on a fresh database that holds the contract's two agents.
async function storeWithAgents() {
  const { host, database } = databases.open(engineDatabase);
  const agents = createSqliteAgentStore(host);
  await agents.create(testAgentDraft({ id: fixtureAgent(1), name: "one" }), live);
  await agents.create(testAgentDraft({ id: fixtureAgent(2), name: "two" }), live);
  return { store: createSqliteAgentTopicStore(host), database };
}

// The id the contract gives its agent `n`.
function fixtureAgent(n: number): Id<"agt"> {
  return idSchema("agt").parse(`agt_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`);
}

describe("sqlite agent topic store", () => {
  it.each(agentTopicStoreContract({ create: async () => (await storeWithAgents()).store }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("keeps one row for each agent and chat", async () => {
    const { store, database } = await storeWithAgents();
    const topic = { agentId: fixtureAgent(1), chatId: 7_012_345_678, threadId: 5, createdAtMs: 9 };
    await store.keep(topic, live);
    await store.keep({ ...topic, threadId: 6 }, live);
    expect(
      database.prepare("SELECT agent_id, chat_id, thread_id FROM telegram_topics").all(),
    ).toEqual([{ agent_id: fixtureAgent(1), chat_id: 7_012_345_678, thread_id: 6 }]);
  });
});
