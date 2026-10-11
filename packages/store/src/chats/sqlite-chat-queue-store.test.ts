import { afterAll, describe, expect, it } from "vitest";
import { chatQueueStoreContract } from "../contracts/chat-queue-store-contract.js";
import { agentDatabase } from "../databases/agent-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteChatQueueStore } from "./sqlite-chat-queue-store.js";
import { createSqliteWriterFence } from "./sqlite-writer-fence.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite chat queue store", () => {
  it.each(
    chatQueueStoreContract({
      create: async () => {
        const { host } = databases.open(agentDatabase);
        return { store: createSqliteChatQueueStore(host), fence: createSqliteWriterFence(host) };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
