import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { agent, callTool, outcomeOf } from "../testing/agent-tool-fixtures.js";

function read(place: string, file = "SKILL.md") {
  return {
    skill: "dca-plan",
    place,
    location: `${place}/dca-plan/SKILL.md`,
    file,
    text: "# DCA plan\n\nBuy the same amount each week.",
  };
}

describe("open_skill", () => {
  it("reads a listed skill's file through the engine, for the turn's agent", async () => {
    const opened = callTool(
      { "skill/read": read("bundled", "references/steps.md") },
      { name: "open_skill", args: { skill: "dca-plan", file: "references/steps.md" } },
    );
    await expect(outcomeOf(opened)).resolves.toStrictEqual({
      text: "Skill dca-plan (bundled/dca-plan/SKILL.md), file references/steps.md:\n\n# DCA plan\n\nBuy the same amount each week.",
      isError: false,
    });
    expect(opened.client.calls()).toStrictEqual([
      { op: "skill/read", args: { agent, skill: "dca-plan", file: "references/steps.md" } },
    ]);
  });

  it("marks the turn when the skill was installed from outside binference", async () => {
    const opened = callTool(
      { "skill/read": read("installed") },
      { name: "open_skill", args: { skill: "dca-plan" } },
    );
    const outcome = await outcomeOf(opened);
    expect(outcome).toMatchObject({ isError: false, outside: true });
    expect(outcome.text).toMatch(/^\[outside content: a skill installed from outside binference\./);
  });

  it.each([
    ["a path that climbs out of the skill", { skill: "dca-plan", file: "../other/SKILL.md" }],
    ["an absolute path", { skill: "dca-plan", file: "/etc/passwd" }],
    ["a hidden file", { skill: "dca-plan", file: ".env" }],
    ["a name with capitals", { skill: "DCA-plan" }],
    ["an agent of its own", { skill: "dca-plan", agent }],
  ])("refuses %s before the engine", (_name, args) => {
    const run = callTool({ "skill/read": read("bundled") }, { name: "open_skill", args });
    expect(run.refused).toMatch(/^not run: the arguments do not match/);
    expect(run.client.calls()).toStrictEqual([]);
  });

  it("answers the engine's refusal of a skill the index does not list as the model's to read", async () => {
    const missing = new BinferenceError({ code: "skill.not_found", message: "No such skill." });
    const opened = callTool(
      { "skill/read": missing },
      { name: "open_skill", args: { skill: "secret-skill" } },
    );
    await expect(outcomeOf(opened)).resolves.toStrictEqual({
      text: "open_skill failed with skill.not_found: No such skill.",
      isError: true,
    });
  });
});
