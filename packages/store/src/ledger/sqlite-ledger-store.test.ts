import { ledgerStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteLedgerStore } from "./sqlite-ledger-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite ledger store", () => {
  it.each(
    ledgerStoreContract({
      create: async () => {
        const { host, database } = databases.open(engineDatabase);
        return { ledger: createSqliteLedgerStore(host), agentId: plantAgent(database, 1).agentId };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
