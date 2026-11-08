import { afterAll, describe, expect, it } from "vitest";
import { helperStoreContract } from "../contracts/helper-store-contract.js";
import { agentDatabase } from "../databases/agent-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteHelperStore } from "./sqlite-helper-store.js";
import { createSqliteSessionStore } from "./sqlite-session-store.js";
import { createSqliteWriterFence } from "./sqlite-writer-fence.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite helper store", () => {
  it.each(
    helperStoreContract({
      create: async () => {
        const { host } = databases.open(agentDatabase);
        return {
          store: createSqliteHelperStore(host),
          sessions: createSqliteSessionStore(host),
          fence: createSqliteWriterFence(host),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
