import { describe, expect, it } from "vitest";
import { noteStoreContract } from "../contracts/note-store-contract.js";
import { createMemoryAgentDatabase } from "./memory-agent-database.js";
import { createMemoryNoteStore } from "./memory-note-store.js";
import { createMemoryWriterFence } from "./memory-writer-fence.js";

describe("memory note store", () => {
  it.each(
    noteStoreContract({
      create: async () => {
        const database = createMemoryAgentDatabase();
        return {
          store: createMemoryNoteStore(database),
          fence: createMemoryWriterFence(database),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
