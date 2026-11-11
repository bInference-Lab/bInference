import { protocolIdSchema } from "@binference/protocol";
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

const proposals = [
  {
    proposal: protocolIdSchema("skillProposal").parse("skp_0190f1c2-3a4b-7c5d-8e6f-000000000002"),
    agent,
    kind: "create",
    name: "dip-buyer",
    description: "Buys after a fall.",
    status: "pending",
    findings: [],
    files: [],
    createdAt: 2,
    updatedAt: 2,
  },
  {
    proposal: protocolIdSchema("skillProposal").parse("skp_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    agent,
    kind: "update",
    name: "safe-swap",
    description: "Checks a swap.",
    status: "rejected",
    findings: [],
    files: [],
    createdAt: 1,
    updatedAt: 1,
    decidedAt: 1,
    reason: "Not now.",
  },
] as const;

describe("createMemoryContextSource", () => {
  it.each(
    contextSourceContract({
      create: async () => {
        const source = createMemoryContextSource({ agents: [agent] });
        source.write(agent, "RULES.md", rules);
        source.setSkills(agent, skills);
        source.setSkillProposals(agent, proposals);
        const unknownAgent = nthTestId("agt", 9);
        return await Promise.resolve({ source, agent, unknownAgent, rules, skills, proposals });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
