import { describe, expect, it } from "vitest";
import { helperStoreContract } from "../contracts/helper-store-contract.js";
import { createMemoryAgentDatabase } from "./memory-agent-database.js";
import { createMemoryHelperStore } from "./memory-helper-store.js";
import { createMemorySessionStore } from "./memory-session-store.js";
import { createMemoryWriterFence } from "./memory-writer-fence.js";

describe("memory helper store", () => {
  it.each(
    helperStoreContract({
      create: async () => {
        const database = createMemoryAgentDatabase();
        return {
          store: createMemoryHelperStore(database),
          sessions: createMemorySessionStore(database),
          fence: createMemoryWriterFence(database),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
