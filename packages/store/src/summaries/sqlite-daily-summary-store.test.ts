import { type Id, idSchema } from "@binference/core";
import { dailySummaryStoreContract, testAgentDraft } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteAgentStore } from "../agents/sqlite-agent-store.js";
import { engineDatabase } from "../databases/engine-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteDailySummaryStore } from "./sqlite-daily-summary-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

const live = { signal: new AbortController().signal };

// The id the contract gives its agent `n`.
function fixtureAgent(n: number): Id<"agt"> {
  return idSchema("agt").parse(`agt_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`);
}

// A summary store on a fresh database that holds the contract's two agents.
async function storeWithAgents() {
  const { host } = databases.open(engineDatabase);
  const agents = createSqliteAgentStore(host);
  await agents.create(testAgentDraft({ id: fixtureAgent(1), name: "one" }), live);
  await agents.create(testAgentDraft({ id: fixtureAgent(2), name: "two" }), live);
  return createSqliteDailySummaryStore(host);
}

describe("sqlite daily summary store", () => {
  it.each(dailySummaryStoreContract({ create: storeWithAgents }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
