import { identityStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteAgentStore } from "../agents/sqlite-agent-store.js";
import { engineDatabase } from "../databases/engine-database.js";
import { createSqliteInstallStore } from "../install/sqlite-install-store.js";
import { createSqliteLedgerStore } from "../ledger/sqlite-ledger-store.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteIdentityStore } from "./sqlite-identity-store.js";
import { createSqliteIntentStore } from "./sqlite-intent-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite identity store", () => {
  it.each(
    identityStoreContract({
      create: async () => {
        const { host, database } = databases.open(engineDatabase);
        return await Promise.resolve({
          identities: createSqliteIdentityStore(host),
          store: createSqliteIntentStore(host),
          ledger: createSqliteLedgerStore(host),
          agents: createSqliteAgentStore(host),
          install: createSqliteInstallStore(host),
          ...plantAgent(database, 1),
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
