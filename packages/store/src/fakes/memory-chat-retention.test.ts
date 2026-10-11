import { describe, expect, it } from "vitest";
import { chatRetentionContract } from "../contracts/chat-retention-contract.js";
import { createMemoryAgentDatabase } from "./memory-agent-database.js";
import { createMemoryChatQueueStore } from "./memory-chat-queue-store.js";
import { createMemoryChatRetention } from "./memory-chat-retention.js";
import { createMemorySessionStore } from "./memory-session-store.js";
import { createMemoryTranscriptStore } from "./memory-transcript-store.js";
import { createMemoryWriterFence } from "./memory-writer-fence.js";

describe("memory chat retention", () => {
  it.each(
    chatRetentionContract({
      create: async () => {
        const database = createMemoryAgentDatabase();
        return {
          retention: createMemoryChatRetention(database),
          sessions: createMemorySessionStore(database),
          transcript: createMemoryTranscriptStore(database),
          queue: createMemoryChatQueueStore(database),
          fence: createMemoryWriterFence(database),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
