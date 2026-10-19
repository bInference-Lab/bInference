import { describe, expect, it } from "vitest";
import { type AlertSubject, alertStoreContract } from "../contracts/alert-store-contract.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { createMemoryAgentInboxStore } from "./memory-agent-inbox-store.js";
import { createMemoryAlertStore } from "./memory-alert-store.js";
import { createMemoryEngineStores } from "./memory-engine-stores.js";

describe("memory alert store", () => {
  it.each(
    alertStoreContract({
      create: async (): Promise<AlertSubject> => {
        const { agents } = createMemoryEngineStores();
        const agentInbox = createMemoryAgentInboxStore({ agents });
        const agentIds = [fixtureId("agt", 1), fixtureId("agt", 2)] as const;
        await agents.create(testAgentDraft({ id: agentIds[0] }), live());
        await agents.create(testAgentDraft({ id: agentIds[1], name: "second" }), live());
        const alerts = createMemoryAlertStore({ agents, agentInbox });
        return { alerts, agentInbox, agentIds };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
