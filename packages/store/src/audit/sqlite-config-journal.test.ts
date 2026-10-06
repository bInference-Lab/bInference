import { configJournalContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteConfigJournal } from "./sqlite-config-journal.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite config journal", () => {
  it.each(
    configJournalContract({
      create: async () => createSqliteConfigJournal(databases.open(engineDatabase).host),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
