import { inboxStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteInboxStore } from "./sqlite-inbox-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite inbox store", () => {
  it.each(
    inboxStoreContract({
      create: async () => createSqliteInboxStore(databases.open(engineDatabase).host),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
