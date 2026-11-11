import { BinferenceError } from "@binference/core";
import { liveFactsViewSchema, protocolIdSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { contextSourceContract } from "../contracts/context-source-contract.js";
import { nthTestId } from "../testing/memory-agent-stores.js";
import {
  createMemoryContextSource,
  type MemoryContextSource,
} from "../testing/memory-context-source.js";
import { createProtocolContextSource } from "./protocol-context-source.js";

const agent = nthTestId("agt", 1);
const rules = "# Rules\nNever buy a token with a tax above 10%.\n";
const skills = [
  { name: "dca-plan", description: "Plans a DCA.", location: "bundled/dca-plan/SKILL.md" },
];

// A protocol client over the fake source, each answer as the engine sends it on the wire: a
// missing file fails with `agent.file_missing`, and the facts travel as JSON.
function clientOver(source: MemoryContextSource) {
  return {
    call: async (op: string, args: Record<string, unknown>, options: { signal: AbortSignal }) => {
      const place = { agent: args["agent"], file: args["file"] } as never;
      if (op === "agent/readFile") {
        const text = await source.workspaceFile(place, options.signal);
        if (text === undefined) {
          throw new BinferenceError({ code: "agent.file_missing", message: "No such file." });
        }
        return { text, updatedAt: 1 };
      }
      if (op === "skillProposal/list") {
        const all = await source.skillProposals(args["agent"] as never, options.signal);
        return {
          items: all.filter(
            (each) => args["status"] === undefined || each.status === args["status"],
          ),
        };
      }
      if (op === "skill/list") {
        const listed = await source.skills(args["agent"] as never, options.signal);
        const views = listed.map(({ name, description, location }) => ({
          name,
          description,
          location,
          skill: `bundled:${name}`,
          source: "bundled",
          hash: "0".repeat(64),
          installedAt: 1,
          place: "bundled",
        }));
        // A skill installed for every agent has no description in a list for no agent.
        return {
          items: [...views, { skill: "x", name: "x", source: "bundled", hash: "", installedAt: 1 }],
        };
      }
      const facts = await source.liveFacts(args["agent"] as never, options.signal);
      const text = JSON.stringify(facts, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      );
      return liveFactsViewSchema.parse(JSON.parse(text) as object);
    },
  } as never;
}

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

describe("createProtocolContextSource", () => {
  it.each(
    contextSourceContract({
      create: async () => {
        const memory = createMemoryContextSource({ agents: [agent] });
        memory.write(agent, "RULES.md", rules);
        memory.setSkills(agent, skills);
        memory.setSkillProposals(agent, proposals);
        const source = createProtocolContextSource(clientOver(memory));
        const unknownAgent = nthTestId("agt", 9);
        return await Promise.resolve({ source, agent, unknownAgent, rules, skills, proposals });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("passes on a failure other than a missing file", async () => {
    const source = createProtocolContextSource({
      call: async () => {
        throw new BinferenceError({ code: "engine.stopping", message: "Stopping." });
      },
    } as never);
    await expect(
      source.workspaceFile({ agent, file: "RULES.md" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "engine.stopping" });
  });

  it("lists no skill from an engine that does not serve skill/list", async () => {
    const source = createProtocolContextSource({
      call: async () => {
        throw new BinferenceError({ code: "protocol.unknown_op", message: "No such operation." });
      },
    } as never);
    await expect(source.skills(agent, new AbortController().signal)).resolves.toStrictEqual([]);
  });
});
