import { accessStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteAccessStore } from "./sqlite-access-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite access store", () => {
  it.each(
    accessStoreContract({
      create: async () => createSqliteAccessStore(databases.open(engineDatabase).host),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
