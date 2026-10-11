import { backupStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteBackupStore } from "./sqlite-backup-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite backup store", () => {
  it.each(
    backupStoreContract({
      create: async () =>
        await Promise.resolve(createSqliteBackupStore(databases.open(engineDatabase).host)),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
