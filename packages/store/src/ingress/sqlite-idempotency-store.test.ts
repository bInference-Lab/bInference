import { idempotencyStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteIdempotencyStore } from "./sqlite-idempotency-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite idempotency store", () => {
  it.each(
    idempotencyStoreContract({
      create: async () => createSqliteIdempotencyStore(databases.open(engineDatabase).host),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
