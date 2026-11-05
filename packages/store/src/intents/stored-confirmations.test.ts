import { confirmationStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { confirmationSubject } from "../testing/money-store-subjects.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("the engine's confirmations over the sqlite intent store", () => {
  it.each(
    confirmationStoreContract({
      create: () => confirmationSubject(databases.open(engineDatabase).host),
    }),
  )("follow the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
