import { positionStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { createIntent } from "../testing/create-intent.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqlitePositionStore } from "./sqlite-position-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite position store", () => {
  it.each(
    positionStoreContract({
      create: async () => {
        const { host, database } = databases.open(engineDatabase);
        const first = plantAgent(database, 1);
        const second = plantAgent(database, 2);
        return {
          store: createSqlitePositionStore(host),
          walletIds: [first.walletId, second.walletId],
          intentId: await createIntent(host, first, 1),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
