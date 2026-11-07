import { credentialStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteCredentialStore, credentialTasks } from "./sqlite-credential-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

const live = { signal: new AbortController().signal };

describe("sqlite credential store", () => {
  it.each(
    credentialStoreContract({
      create: async () =>
        Promise.resolve(createSqliteCredentialStore(databases.open(engineDatabase).host)),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("keeps the value in its row, and the table refuses a name that is no variable's", async () => {
    const { host, database } = databases.open(engineDatabase);
    await createSqliteCredentialStore(host).put(
      { name: "API_KEY", value: "kept", allowedHosts: ["api.example.com"], atMs: 1 },
      live,
    );
    expect(database.prepare("SELECT name, value, allowed_hosts FROM credentials").all()).toEqual([
      { name: "API_KEY", value: "kept", allowed_hosts: '["api.example.com"]' },
    ]);
    expect(() =>
      database.prepare("INSERT INTO credentials VALUES ('api_key', 'x', '[]', 1, NULL)").run(),
    ).toThrow(/CHECK/);
  });

  it("has every task it runs served by the engine database's workers", () => {
    expect(engineDatabase.tasks).toStrictEqual(expect.arrayContaining([...credentialTasks]));
  });
});
