import { dailySummaryStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { withTwoAgents } from "../testing/engine-store-subjects.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteDailySummaryStore } from "./sqlite-daily-summary-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite daily summary store", () => {
  it.each(
    dailySummaryStoreContract({
      create: async () =>
        createSqliteDailySummaryStore(await withTwoAgents(databases.open(engineDatabase).host)),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
