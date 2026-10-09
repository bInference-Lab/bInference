import { riskCacheStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteRiskCacheStore } from "./sqlite-risk-cache-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite risk cache store", () => {
  it.each(
    riskCacheStoreContract({
      create: async () =>
        await Promise.resolve({
          store: createSqliteRiskCacheStore(databases.open(engineDatabase).host),
          sources: ["goplus", "honeypot"] as const,
          refused: "codex",
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
