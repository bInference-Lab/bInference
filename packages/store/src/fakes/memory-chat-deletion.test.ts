import { describe, expect, it } from "vitest";
import { chatDeletionContract } from "../contracts/chat-deletion-contract.js";
import { createMemoryAgentDatabase } from "./memory-agent-database.js";
import { createMemoryChatDeletion } from "./memory-chat-deletion.js";
import { createMemoryChatQueueStore } from "./memory-chat-queue-store.js";
import { createMemoryGoalStore } from "./memory-goal-store.js";
import { createMemoryHelperStore } from "./memory-helper-store.js";
import { createMemoryNoteStore } from "./memory-note-store.js";
import { createMemorySessionStore } from "./memory-session-store.js";
import { createMemoryTranscriptStore } from "./memory-transcript-store.js";
import { createMemoryWriterFence } from "./memory-writer-fence.js";

describe("memory chat deletion", () => {
  it.each(
    chatDeletionContract({
      create: async () => {
        const database = createMemoryAgentDatabase();
        return {
          deletion: createMemoryChatDeletion(database),
          sessions: createMemorySessionStore(database),
          transcript: createMemoryTranscriptStore(database),
          queue: createMemoryChatQueueStore(database),
          helpers: createMemoryHelperStore(database),
          goals: createMemoryGoalStore(database),
          notes: createMemoryNoteStore(database),
          fence: createMemoryWriterFence(database),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
