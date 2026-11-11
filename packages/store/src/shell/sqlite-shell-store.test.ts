import { shellStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteShellStore, shellTasks } from "./sqlite-shell-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite shell store", () => {
  it.each(
    shellStoreContract({
      create: async () =>
        Promise.resolve(createSqliteShellStore(databases.open(engineDatabase).host)),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("numbers allowed commands in the order they were kept, and refuses arguments that are no list", () => {
    const { database } = databases.open(engineDatabase);
    const insert = database.prepare(
      "INSERT INTO shell_allowed (id, text, program, args, folder, allowed_at) VALUES (?, 'ls', '/bin/ls', ?, '/srv', 1)",
    );
    insert.run("sac_0190f1c2-3a4b-7c5d-8e6f-000000000002", "[]");
    insert.run("sac_0190f1c2-3a4b-7c5d-8e6f-000000000001", '["-l"]');
    expect(database.prepare("SELECT id, seq FROM shell_allowed ORDER BY seq").all()).toEqual([
      { id: "sac_0190f1c2-3a4b-7c5d-8e6f-000000000002", seq: 1 },
      { id: "sac_0190f1c2-3a4b-7c5d-8e6f-000000000001", seq: 2 },
    ]);
    expect(() => insert.run("sac_0190f1c2-3a4b-7c5d-8e6f-000000000003", '"-a"')).toThrow(/CHECK/);
  });

  it("has every task it runs served by the engine database's workers", () => {
    expect(engineDatabase.tasks).toStrictEqual(expect.arrayContaining([...shellTasks]));
  });
});
