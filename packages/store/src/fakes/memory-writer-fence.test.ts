import { describe, expect, it } from "vitest";
import { writerFenceContract } from "../contracts/writer-fence-contract.js";
import { createMemoryAgentDatabase } from "./memory-agent-database.js";
import { createMemoryWriterFence } from "./memory-writer-fence.js";

describe("memory writer fence", () => {
  it.each(
    writerFenceContract({
      create: async () => createMemoryWriterFence(createMemoryAgentDatabase()),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
