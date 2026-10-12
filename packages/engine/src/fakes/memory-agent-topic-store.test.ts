import { describe, expect, it } from "vitest";
import { agentTopicStoreContract } from "../contracts/agent-topic-store-contract.js";
import { createMemoryAgentTopicStore } from "./memory-agent-topic-store.js";

describe("memory agent topic store", () => {
  it.each(agentTopicStoreContract({ create: async () => createMemoryAgentTopicStore() }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
