import { describe, expect, it } from "vitest";
import { transcriptStoreContract } from "../contracts/transcript-store-contract.js";
import { createMemoryAgentDatabase } from "./memory-agent-database.js";
import { createMemorySessionStore } from "./memory-session-store.js";
import { createMemoryTranscriptStore } from "./memory-transcript-store.js";
import { createMemoryWriterFence } from "./memory-writer-fence.js";

describe("memory transcript store", () => {
  it.each(
    transcriptStoreContract({
      create: async () => {
        const database = createMemoryAgentDatabase();
        return {
          store: createMemoryTranscriptStore(database),
          sessions: createMemorySessionStore(database),
          fence: createMemoryWriterFence(database),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
