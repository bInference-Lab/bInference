import { unbondingStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { createIntent } from "../testing/create-intent.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteUnbondingStore } from "./sqlite-unbonding-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite unbonding store", () => {
  it.each(
    unbondingStoreContract({
      create: async () => {
        const { host, database } = databases.open(engineDatabase);
        const agent = plantAgent(database, 1);
        const intentIds = [
          await createIntent(host, agent, 1),
          await createIntent(host, agent, 2),
          await createIntent(host, agent, 3),
        ] as const;
        const store = createSqliteUnbondingStore(host);
        return { store, intentIds, walletId: agent.walletId };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
