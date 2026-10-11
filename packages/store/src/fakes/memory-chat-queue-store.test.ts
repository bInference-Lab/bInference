import { describe, expect, it } from "vitest";
import { chatQueueStoreContract } from "../contracts/chat-queue-store-contract.js";
import { createMemoryAgentDatabase } from "./memory-agent-database.js";
import { createMemoryChatQueueStore } from "./memory-chat-queue-store.js";
import { createMemoryWriterFence } from "./memory-writer-fence.js";

describe("memory chat queue store", () => {
  it.each(
    chatQueueStoreContract({
      create: async () => {
        const database = createMemoryAgentDatabase();
        return {
          store: createMemoryChatQueueStore(database),
          fence: createMemoryWriterFence(database),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
