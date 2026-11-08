import { describe, expect, it } from "vitest";
import { goalStoreContract } from "../contracts/goal-store-contract.js";
import { createMemoryAgentDatabase } from "./memory-agent-database.js";
import { createMemoryGoalStore } from "./memory-goal-store.js";
import { createMemorySessionStore } from "./memory-session-store.js";
import { createMemoryWriterFence } from "./memory-writer-fence.js";

describe("memory goal store", () => {
  it.each(
    goalStoreContract({
      create: async () => {
        const database = createMemoryAgentDatabase();
        return {
          store: createMemoryGoalStore(database),
          sessions: createMemorySessionStore(database),
          fence: createMemoryWriterFence(database),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
