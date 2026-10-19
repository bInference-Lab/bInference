import { describe, expect, it } from "vitest";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import {
  type TrackedWalletSubject,
  trackedWalletStoreContract,
} from "../contracts/tracked-wallet-store-contract.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { archivingAgents } from "./archiving-agents.js";
import { createMemoryAgentInboxStore } from "./memory-agent-inbox-store.js";
import { createMemoryAlertStore } from "./memory-alert-store.js";
import { createMemoryEngineStores } from "./memory-engine-stores.js";
import { createMemoryTrackedWalletStore } from "./memory-tracked-wallet-store.js";
import { createMemoryTracking } from "./memory-tracking.js";

describe("memory tracked wallet store", () => {
  it.each(
    trackedWalletStoreContract({
      create: async (): Promise<TrackedWalletSubject> => {
        const stores = createMemoryEngineStores();
        const archived = new Set<string>();
        const agents = archivingAgents(stores.agents, archived);
        const agentInbox = createMemoryAgentInboxStore({ agents });
        const agentIds = [fixtureId("agt", 1), fixtureId("agt", 2)] as const;
        await stores.agents.create(testAgentDraft({ id: agentIds[0] }), live());
        await stores.agents.create(testAgentDraft({ id: agentIds[1], name: "second" }), live());
        const tracking = createMemoryTracking();
        const alerts = createMemoryAlertStore({ agents, agentInbox, tracking });
        const tracked = createMemoryTrackedWalletStore(tracking);
        const archive = async (agent: string) => {
          archived.add(agent);
          return Promise.resolve();
        };
        return { alerts, agentInbox, agentIds, archive, tracked };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
