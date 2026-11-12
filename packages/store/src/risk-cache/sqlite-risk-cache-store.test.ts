import { riskCacheStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { riskCacheSubject } from "../testing/engine-store-subjects.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite risk cache store", () => {
  it.each(
    riskCacheStoreContract({
      create: async () => Promise.resolve(riskCacheSubject(databases.open(engineDatabase).host)),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
