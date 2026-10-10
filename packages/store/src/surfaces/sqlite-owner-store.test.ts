import { ownerStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteOwnerStore } from "./sqlite-owner-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

const live = { signal: new AbortController().signal };

describe("sqlite owner store", () => {
  it.each(
    ownerStoreContract({
      create: async () =>
        Promise.resolve(createSqliteOwnerStore(databases.open(engineDatabase).host)),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("keeps the owner in one row that a second store on the database reads", async () => {
    const { host, database } = databases.open(engineDatabase);
    await createSqliteOwnerStore(host).bind({ userId: 7_100_000_001, pairedAtMs: 5 }, live);
    await expect(createSqliteOwnerStore(host).get(live)).resolves.toStrictEqual({
      userId: 7_100_000_001,
      pairedAtMs: 5,
    });
    expect(database.prepare("SELECT id, user_id, paired_at FROM telegram_owner").all()).toEqual([
      { id: 1, user_id: 7_100_000_001, paired_at: 5 },
    ]);
  });
});
