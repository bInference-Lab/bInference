import { describe, expect, it } from "vitest";
import type { IntentStoreSubject } from "../contracts/intent-fixtures.js";
import { intentStoreContract } from "../contracts/intent-store-contract.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { createMemoryAgentStore } from "./memory-agent-store.js";
import { createMemoryEngineStores } from "./memory-engine-stores.js";
import { createMemoryIntentStore } from "./memory-intent-store.js";
import { createMemoryLedgerStore } from "./memory-ledger-store.js";

const agentId = fixtureId("agt", 1);
const walletId = fixtureId("wal", 1);

describe("memory intent store", () => {
  it.each(
    intentStoreContract({
      create: async (): Promise<IntentStoreSubject> => {
        const ledger = createMemoryLedgerStore();
        const agents = createMemoryAgentStore();
        await agents.create(testAgentDraft({ id: agentId }), live());
        const store = createMemoryIntentStore({ ledger, agents });
        return { store, ledger, agents, agentId, walletId };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("passes the contract as part of every engine store in memory", async () => {
    const checks = intentStoreContract({
      create: async (): Promise<IntentStoreSubject> => {
        const { intents, ledger, agents } = createMemoryEngineStores();
        await agents.create(testAgentDraft({ id: agentId }), live());
        return { store: intents, ledger, agents, agentId, walletId };
      },
    });
    await expect(Promise.all(checks.map(async (check) => check.run()))).resolves.toHaveLength(
      checks.length,
    );
  });
});
