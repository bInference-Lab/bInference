import { describe, expect, it } from "vitest";
import { contextSourceContract } from "../contracts/context-source-contract.js";
import { nthTestId } from "./memory-agent-stores.js";
import { createMemoryContextSource } from "./memory-context-source.js";

const agent = nthTestId("agt", 1);
const rules = "# Rules\nNever buy a token with a tax above 10%.\n";

describe("createMemoryContextSource", () => {
  it.each(
    contextSourceContract({
      create: async () => {
        const source = createMemoryContextSource({ agents: [agent] });
        source.write(agent, "RULES.md", rules);
        return await Promise.resolve({ source, agent, unknownAgent: nthTestId("agt", 9), rules });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
