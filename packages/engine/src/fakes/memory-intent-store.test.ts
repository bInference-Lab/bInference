import { describe, expect, it } from "vitest";
import { intentStoreContract } from "../contracts/intent-store-contract.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryEngineStores } from "./memory-engine-stores.js";
import { createMemoryIntentStore } from "./memory-intent-store.js";
import { createMemoryLedgerStore } from "./memory-ledger-store.js";

describe("memory intent store", () => {
  it.each(
    intentStoreContract({
      create: async () => {
        const ledger = createMemoryLedgerStore();
        const store = createMemoryIntentStore({ ledger });
        return { store, ledger, agentId: fixtureId("agt", 1), walletId: fixtureId("wal", 1) };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("passes the contract as part of every engine store in memory", async () => {
    const checks = intentStoreContract({
      create: async () => {
        const { intents, ledger } = createMemoryEngineStores();
        return {
          store: intents,
          ledger,
          agentId: fixtureId("agt", 1),
          walletId: fixtureId("wal", 1),
        };
      },
    });
    await expect(Promise.all(checks.map(async (check) => check.run()))).resolves.toHaveLength(
      checks.length,
    );
  });
});
