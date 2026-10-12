import { questionStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteAgentInboxStore } from "./sqlite-agent-inbox-store.js";
import { createSqliteQuestionStore, questionTasks } from "./sqlite-question-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite question store", () => {
  it.each(
    questionStoreContract({
      create: async () => {
        const { host, database } = databases.open(engineDatabase);
        return {
          questions: createSqliteQuestionStore(host),
          agentInbox: createSqliteAgentInboxStore(host),
          agentId: plantAgent(database, 1).agentId,
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("has every task it runs served by the engine database's workers", () => {
    expect(engineDatabase.tasks).toStrictEqual(expect.arrayContaining([...questionTasks]));
  });
});
