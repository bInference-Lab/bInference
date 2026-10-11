import { describe, expect, it } from "vitest";
import {
  type AgentInboxSubject,
  agentInboxStoreContract,
} from "../contracts/agent-inbox-store-contract.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { createMemoryEngineStores } from "./memory-engine-stores.js";

describe("memory agent inbox store", () => {
  it.each(
    agentInboxStoreContract({
      create: async (): Promise<AgentInboxSubject> => {
        const stores = createMemoryEngineStores();
        const agentId = fixtureId("agt", 1);
        await stores.agents.create(testAgentDraft({ id: agentId }), live());
        return {
          store: stores.intents,
          ledger: stores.ledger,
          agents: stores.agents,
          install: stores.install,
          agentInbox: stores.agentInbox,
          agentId,
          walletId: fixtureId("wal", 1),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
