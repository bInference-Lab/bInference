import { describe, expect, it } from "vitest";
import { sessionStoreContract } from "../contracts/session-store-contract.js";
import { createMemoryAgentDatabase } from "./memory-agent-database.js";
import { createMemorySessionStore } from "./memory-session-store.js";
import { createMemoryWriterFence } from "./memory-writer-fence.js";

describe("memory session store", () => {
  it.each(
    sessionStoreContract({
      create: async () => {
        const database = createMemoryAgentDatabase();
        return {
          store: createMemorySessionStore(database),
          fence: createMemoryWriterFence(database),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
