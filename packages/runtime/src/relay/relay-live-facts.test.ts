import { describe, expect, it } from "vitest";
import { liveFactsReaderContract } from "../contracts/live-facts-reader-contract.js";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { createMemoryContextSource } from "../testing/memory-context-source.js";
import { createRelayLiveFacts } from "./relay-live-facts.js";

const agent = nthTestId("agt", 1);

describe("createRelayLiveFacts", () => {
  it.each(
    liveFactsReaderContract({
      create: async () => {
        const source = createMemoryContextSource({ agents: [agent] });
        const reader = createRelayLiveFacts(source, agent);
        return await Promise.resolve({ reader, agent, goDown: () => source.link("down") });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
