import { launchStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { readsPastOldEscape } from "../testing/old-json-text.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteLaunchStore } from "./sqlite-launch-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite launch store", () => {
  it.each(
    launchStoreContract({
      create: async () => createSqliteLaunchStore(databases.open(engineDatabase).host),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("lists launches and reads JSON fields past a row that holds an escaped U+0000", async () => {
    await expect(readsPastOldEscape(databases.open(engineDatabase).host)).resolves.toBeUndefined();
  });
});
