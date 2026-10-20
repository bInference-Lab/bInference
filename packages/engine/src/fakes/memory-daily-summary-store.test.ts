import { describe, expect, it } from "vitest";
import { dailySummaryStoreContract } from "../contracts/daily-summary-store-contract.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { createMemoryAgentStore } from "./memory-agent-store.js";
import { createMemoryDailySummaryStore } from "./memory-daily-summary-store.js";

// A summary store whose agent store holds the contract's two agents.
async function storeWithAgents() {
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft({ id: fixtureId("agt", 1), name: "one" }), live());
  await agents.create(testAgentDraft({ id: fixtureId("agt", 2), name: "two" }), live());
  return createMemoryDailySummaryStore({ agents });
}

describe("memory daily summary store", () => {
  it.each(dailySummaryStoreContract({ create: storeWithAgents }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
