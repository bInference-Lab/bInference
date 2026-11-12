import { agentInboxStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { agentInboxSubject } from "../testing/engine-store-subjects.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { agentInboxTasks } from "./sqlite-agent-inbox-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite agent inbox store", () => {
  it.each(
    agentInboxStoreContract({
      create: async () => agentInboxSubject(databases.open(engineDatabase).host),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("has every task it runs served by the engine database's workers", () => {
    expect(engineDatabase.tasks).toStrictEqual(expect.arrayContaining([...agentInboxTasks]));
  });
});
