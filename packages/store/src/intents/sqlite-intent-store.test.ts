import { intentStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteAgentStore } from "../agents/sqlite-agent-store.js";
import { engineDatabase } from "../databases/engine-database.js";
import { createSqliteInstallStore } from "../install/sqlite-install-store.js";
import { createSqliteLedgerStore } from "../ledger/sqlite-ledger-store.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteIntentStore } from "./sqlite-intent-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite intent store", () => {
  it.each(
    intentStoreContract({
      create: async () => {
        const { host, database } = databases.open(engineDatabase);
        const store = createSqliteIntentStore(host);
        const ledger = createSqliteLedgerStore(host);
        const agents = createSqliteAgentStore(host);
        const install = createSqliteInstallStore(host);
        return { store, ledger, agents, install, ...plantAgent(database, 1) };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
