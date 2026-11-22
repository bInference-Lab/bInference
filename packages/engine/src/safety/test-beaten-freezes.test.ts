import { describe, expect, it } from "vitest";
import type { IntentStoreSubject } from "../contracts/intent-fixtures.js";
import { intentStoreContract } from "../contracts/intent-store-contract.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { createMemoryInstallStore } from "../fakes/memory-install-store.js";
import { createMemoryIntentStore } from "../fakes/memory-intent-store.js";
import { createMemoryLedgerStore } from "../fakes/memory-ledger-store.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { beatenFreezes } from "./test-beaten-freezes.js";

const agentId = fixtureId("agt", 1);
const walletId = fixtureId("wal", 1);

describe("an intent store whose freezes no write beats", () => {
  it.each(
    intentStoreContract({
      create: async (): Promise<IntentStoreSubject> => {
        const ledger = createMemoryLedgerStore();
        const install = createMemoryInstallStore();
        const agents = createMemoryAgentStore({ install });
        await agents.create(testAgentDraft({ id: agentId }), live());
        const fake = createMemoryIntentStore({ ledger, agents, install });
        const store = beatenFreezes(0).wrap(fake);
        return { store, ledger, agents, install, agentId, walletId };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
