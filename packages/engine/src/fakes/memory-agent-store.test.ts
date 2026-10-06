import { describe, expect, it } from "vitest";
import { agentStoreContract } from "../contracts/agent-store-contract.js";
import { createMemoryAgentStore } from "./memory-agent-store.js";

describe("memory agent store", () => {
  it.each(agentStoreContract({ create: async () => createMemoryAgentStore() }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
