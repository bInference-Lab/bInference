import { describe, expect, it } from "vitest";
import { contextSourceContract } from "../contracts/context-source-contract.js";
import { nthTestId } from "./memory-agent-stores.js";
import { createMemoryContextSource } from "./memory-context-source.js";

const agent = nthTestId("agt", 1);
const rules = "# Rules\nNever buy a token with a tax above 10%.\n";
const skills = [
  { name: "dca-plan", description: "Plans a DCA.", location: "bundled/dca-plan/SKILL.md" },
  { name: "safe-swap", description: "Checks a swap.", location: "bundled/safe-swap/SKILL.md" },
];

describe("createMemoryContextSource", () => {
  it.each(
    contextSourceContract({
      create: async () => {
        const source = createMemoryContextSource({ agents: [agent] });
        source.write(agent, "RULES.md", rules);
        source.setSkills(agent, skills);
        const unknownAgent = nthTestId("agt", 9);
        return await Promise.resolve({ source, agent, unknownAgent, rules, skills });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
