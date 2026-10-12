import { describe, expect, it } from "vitest";
import { modelUsageStoreContract } from "../contracts/model-usage-store-contract.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { createMemoryAgentStore } from "./memory-agent-store.js";
import { createMemoryModelUsageStore } from "./memory-model-usage-store.js";

// A usage store whose agent store holds the contract's two agents.
async function storeWithAgents() {
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft({ id: fixtureId("agt", 1), name: "one" }), live());
  await agents.create(testAgentDraft({ id: fixtureId("agt", 2), name: "two" }), live());
  return createMemoryModelUsageStore({ agents });
}

describe("memory model usage store", () => {
  it.each(modelUsageStoreContract({ create: storeWithAgents }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("refuses usage of an agent it does not hold", async () => {
    const store = await storeWithAgents();
    const charge = {
      agent: fixtureId("agt", 9),
      turn: fixtureId("trn", 1),
      key: "k",
      model: "m",
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      usdMicros: 0n,
      atMs: 0,
    };
    await expect(store.record(charge, live())).rejects.toMatchObject({ code: "store.constraint" });
  });
});
