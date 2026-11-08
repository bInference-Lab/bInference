import { afterAll, describe, expect, it } from "vitest";
import { goalStoreContract } from "../contracts/goal-store-contract.js";
import { agentDatabase } from "../databases/agent-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteGoalStore } from "./sqlite-goal-store.js";
import { createSqliteSessionStore } from "./sqlite-session-store.js";
import { createSqliteWriterFence } from "./sqlite-writer-fence.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite goal store", () => {
  it.each(
    goalStoreContract({
      create: async () => {
        const { host } = databases.open(agentDatabase);
        return {
          store: createSqliteGoalStore(host),
          sessions: createSqliteSessionStore(host),
          fence: createSqliteWriterFence(host),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
