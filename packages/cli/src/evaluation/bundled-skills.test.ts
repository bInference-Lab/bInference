import { idSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { agentTools } from "@binference/runtime/testing";
import { describe, expect, it } from "vitest";
import { type EvaluationSkill, loadBundledSkills } from "./bundled-skills.js";
import { loadScenarios, scenarioFolder } from "./load-scenarios.js";
import { runScenario } from "./run-scenario.js";
import { scenarioWebOf } from "./scenario-web.js";
import { standInChain } from "./stand-in-models.js";

// The skills binference bundles for its agents: each reaches every agent's index past the install
// lint, reads whole through open_skill, and names only tools the agent has.

const skills = await loadBundledSkills(AbortSignal.timeout(10_000));
const book = await loadScenarios(scenarioFolder, AbortSignal.timeout(10_000));
const clock = createManualClock(1_767_261_600_000);
const web = scenarioWebOf({}, clock);

const toolNames = new Set(
  agentTools({
    agent: idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    client: { call: async () => Promise.reject(new Error("No engine answers here.")) },
    turn: {
      session: idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
      turn: idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    },
    // With an X key too, so every tool an agent may have is listed.
    web: { ...web, search: { ...web.search, xApiKey: "evaluation" } },
  }).map((tool) => tool.name),
);

// Risk flag codes a skill quotes, which read like a tool's name.
const quotedCodes = new Set(["not_covered"]);

// Every word in code that reads like a tool's name: snake case, or a word a send would be named by.
function namedTools(text: string): readonly string[] {
  const coded = [...text.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((match) => match[1] ?? "");
  return coded.filter(
    (word) => /_/.test(word) || /^(?:send|transfer|withdraw|bridge|approve)$/.test(word),
  );
}

async function openedText(skill: EvaluationSkill, signal: AbortSignal): Promise<string> {
  const scenario = book.scenarios.find((item) => item.skill === skill.name);
  if (scenario === undefined) {
    throw new Error(`No scenario tests ${skill.name}.`);
  }
  const opens = [{ calls: [{ name: "open_skill", args: { skill: skill.name } }] }, { text: "OK." }];
  const model = () => standInChain(opens, clock);
  const run = await runScenario(scenario, { world: book.world, model, clock, signal });
  return run.calls.find((call) => call.name === "open_skill")?.result ?? "";
}

describe("the bundled agent skills", () => {
  it("reach every agent's index past the install lint, each for agents alone", () => {
    expect(skills.map((skill) => skill.name)).toEqual(["safe-swap", "token-due-diligence"]);
    expect(skills.every((skill) => skill.text.includes("binference-audience: agent"))).toBe(true);
  });

  describe.each(skills.map((skill) => [skill.name, skill] as const))(
    "the %s skill",
    (_name, skill) => {
      it("reads whole through open_skill", async ({ signal }) => {
        const heading = `Skill ${skill.name} (${skill.location}), file SKILL.md:`;
        expect(await openedText(skill, signal)).toBe(`${heading}\n\n${skill.text}`);
      });

      it("names only tools the agent has", () => {
        const named = namedTools(skill.text).filter((word) => !quotedCodes.has(word));
        expect(named.filter((word) => !toolNames.has(word))).toEqual([]);
      });
    },
  );
});
