import { describe, expect, it } from "vitest";
import { type AlertSubject, alertStoreContract } from "../contracts/alert-store-contract.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { archivingAgents } from "./archiving-agents.js";
import { createMemoryAgentInboxStore } from "./memory-agent-inbox-store.js";
import { createMemoryAlertStore } from "./memory-alert-store.js";
import { createMemoryEngineStores } from "./memory-engine-stores.js";

describe("memory alert store", () => {
  it.each(
    alertStoreContract({
      create: async (): Promise<AlertSubject> => {
        const stores = createMemoryEngineStores();
        const archived = new Set<string>();
        const agents = archivingAgents(stores.agents, archived);
        const agentInbox = createMemoryAgentInboxStore({ agents });
        const agentIds = [fixtureId("agt", 1), fixtureId("agt", 2)] as const;
        await stores.agents.create(testAgentDraft({ id: agentIds[0] }), live());
        await stores.agents.create(testAgentDraft({ id: agentIds[1], name: "second" }), live());
        const alerts = createMemoryAlertStore({ agents, agentInbox });
        const archive = async (agent: string) => {
          archived.add(agent);
          return Promise.resolve();
        };
        return { alerts, agentInbox, agentIds, archive };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
