import { aliveStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { aliveTasks, createSqliteAliveStore } from "./sqlite-alive-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

const live = { signal: new AbortController().signal };

describe("sqlite alive store", () => {
  it.each(
    aliveStoreContract({
      create: async () =>
        Promise.resolve(createSqliteAliveStore(databases.open(engineDatabase).host)),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("starts with the mark of the migration that made it, so an update's start re-checks", async () => {
    const { host } = databases.open(engineDatabase);
    await expect(createSqliteAliveStore(host).lastAlive(live)).resolves.toBeGreaterThan(0);
  });

  it("keeps the mark in one row that a second store on the database reads", async () => {
    const { host, database } = databases.open(engineDatabase);
    await createSqliteAliveStore(host).markAlive(5_000, live);
    await createSqliteAliveStore(host).markAlive(65_000, live);
    await expect(createSqliteAliveStore(host).lastAlive(live)).resolves.toBe(65_000);
    expect(database.prepare("SELECT id, alive_at FROM engine_alive").all()).toEqual([
      { id: 1, alive_at: 65_000 },
    ]);
  });

  it("has every task it runs served by the engine database's workers", () => {
    expect(engineDatabase.tasks).toStrictEqual(expect.arrayContaining([...aliveTasks]));
  });
});
