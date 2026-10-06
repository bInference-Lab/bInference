import { intentStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
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
        return { store, ledger: createSqliteLedgerStore(host), ...plantAgent(database, 1) };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
