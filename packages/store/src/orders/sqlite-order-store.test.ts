import { orderStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteAgentStore } from "../agents/sqlite-agent-store.js";
import { engineDatabase } from "../databases/engine-database.js";
import { createSqliteIntentStore } from "../intents/sqlite-intent-store.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteOrderStore } from "./sqlite-order-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite order store", () => {
  it.each(
    orderStoreContract({
      create: async () => {
        const { host, database } = databases.open(engineDatabase);
        return {
          store: createSqliteOrderStore(host),
          intents: createSqliteIntentStore(host),
          agents: createSqliteAgentStore(host),
          ...plantAgent(database, 1),
          other: plantAgent(database, 2),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
