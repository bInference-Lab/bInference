import { afterAll, describe, expect, it } from "vitest";
import { sessionStoreContract } from "../contracts/session-store-contract.js";
import { agentDatabase } from "../databases/agent-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteSessionStore } from "./sqlite-session-store.js";
import { createSqliteWriterFence } from "./sqlite-writer-fence.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite session store", () => {
  it.each(
    sessionStoreContract({
      create: async () => {
        const { host } = databases.open(agentDatabase);
        return { store: createSqliteSessionStore(host), fence: createSqliteWriterFence(host) };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
