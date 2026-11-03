import { describe, expect, it } from "vitest";
import { identityStoreContract } from "../contracts/identity-store-contract.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { createMemoryEngineStores } from "./memory-engine-stores.js";
import { createMemoryIdentityStore } from "./memory-identity-store.js";

const agentId = fixtureId("agt", 1);
const walletId = fixtureId("wal", 1);

describe("memory identity store", () => {
  it.each(
    identityStoreContract({
      create: async () => {
        const { intents, ledger, agents, install } = createMemoryEngineStores();
        await agents.create(testAgentDraft({ id: agentId }), live());
        const identities = createMemoryIdentityStore(intents);
        return { identities, store: intents, ledger, agents, install, agentId, walletId };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
