import { describe, expect, it } from "vitest";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { createMemoryContextSource } from "../testing/memory-context-source.js";
import {
  fileMaxChars,
  indexMaxSkills,
  prefixText,
  readTurnPrefix,
  workspaceMaxChars,
} from "./turn-prefix.js";

const agent = nthTestId("agt", 1);
const signal = new AbortController().signal;
const turn = { agent, instructions: "Instructions." };

describe("the stable prefix", () => {
  it("is the instructions, then each workspace file the agent has, in the context's order", async () => {
    const source = createMemoryContextSource();
    source.write(agent, "NOTES.md", "notes");
    source.write(agent, "RULES.md", "rules");
    source.write(agent, "FIRST-CHAT.md", "questions");
    expect(await readTurnPrefix(source, turn, signal)).toBe(
      [
        "Instructions.",
        "# Workspace files\n\nThe owner's files for this agent, in the owner's words.",
        '<workspace-file name="RULES.md">\nrules\n</workspace-file>',
        '<workspace-file name="NOTES.md">\nnotes\n</workspace-file>',
        '<workspace-file name="FIRST-CHAT.md">\nquestions\n</workspace-file>',
      ].join("\n\n"),
    );
  });

  it("leaves the first chat's script out while the agent is live, and keeps it in paper mode", async () => {
    const source = createMemoryContextSource();
    source.write(agent, "STRATEGY.md", "Hold for days.");
    source.write(agent, "FIRST-CHAT.md", "questions");
    source.setMode(agent, "live");
    const live = await readTurnPrefix(source, turn, signal);
    source.setMode(agent, "paper");
    const paper = await readTurnPrefix(source, turn, signal);
    expect(live).toContain("Hold for days.");
    expect(live).not.toContain("FIRST-CHAT.md");
    expect(paper).toContain('<workspace-file name="FIRST-CHAT.md">\nquestions\n</workspace-file>');
  });

  it("reads no live facts for an agent with no first chat", async () => {
    const source = createMemoryContextSource();
    source.write(agent, "STRATEGY.md", "Hold for days.");
    await readTurnPrefix(source, turn, signal);
    expect(source.factReads()).toBe(0);
  });

  it("is the same bytes while nothing changes, and holds an edit at the next read", async () => {
    const source = createMemoryContextSource();
    source.write(agent, "STRATEGY.md", "Hold for days.");
    const first = await readTurnPrefix(source, turn, signal);
    const second = await readTurnPrefix(source, turn, signal);
    source.write(agent, "STRATEGY.md", "Hold for hours.");
    const edited = await readTurnPrefix(source, turn, signal);
    expect(second).toBe(first);
    expect(edited).toContain("Hold for hours.");
    expect(edited).not.toContain("Hold for days.");
  });

  it("is the instructions alone for an agent with no workspace file", async () => {
    expect(await readTurnPrefix(createMemoryContextSource(), turn, signal)).toBe("Instructions.");
  });

  it("cuts a file at 12,000 characters and all of them at 40,000, saying so", () => {
    const long = "a".repeat(fileMaxChars + 5);
    const files = (["RULES.md", "PERSONA.md", "OWNER.md", "STRATEGY.md", "NOTES.md"] as const).map(
      (file) => ({ file, text: long }),
    );
    const prefix = prefixText("Instructions.", files);
    expect(prefix).toContain(
      "[RULES.md is cut here: the prefix keeps 12000 of its 12005 characters.]",
    );
    expect(prefix).toContain(
      `[STRATEGY.md is cut here: the prefix keeps ${String(workspaceMaxChars - 3 * fileMaxChars)} of its 12005 characters.]`,
    );
    expect(prefix).toContain(
      "[NOTES.md is left out: the workspace files are over 40000 characters.]",
    );
    expect(prefix.split("a".repeat(100)).length).toBeLessThan(workspaceMaxChars / 100 + 5);
  });

  it("rejects when the engine cannot answer", async () => {
    const source = createMemoryContextSource();
    source.link("down");
    await expect(readTurnPrefix(source, turn, signal)).rejects.toThrow(
      "The engine cannot answer for this agent.",
    );
  });
});

describe("the skills index in the stable prefix", () => {
  const skills = [
    {
      name: "safe-swap",
      description: "Checks a swap\nbefore it goes.",
      location: "bundled/safe-swap/SKILL.md",
    },
    { name: "dca-plan", description: "Plans a DCA.", location: "installed/dca-plan/SKILL.md" },
  ];

  it("follows the workspace files and lists each skill by name, location and description", async () => {
    const source = createMemoryContextSource();
    source.write(agent, "RULES.md", "rules");
    source.setSkills(agent, skills);
    const prefix = await readTurnPrefix(source, turn, signal);
    const workspaceEnd = prefix.indexOf("</workspace-file>");
    expect(prefix.indexOf("# Skills")).toBeGreaterThan(workspaceEnd);
    expect(prefix.split("\n\n").at(-1)).toBe(
      [
        "- dca-plan (installed/dca-plan/SKILL.md): Plans a DCA.",
        "- safe-swap (bundled/safe-swap/SKILL.md): Checks a swap before it goes.",
      ].join("\n"),
    );
    expect(prefix).toContain("open it with open_skill by its name");
  });

  it("holds the index alone, never a skill's own text", () => {
    const prefix = prefixText("Instructions.", [], skills);
    expect(prefix).not.toContain("# Safe swap");
    expect(prefix.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(2);
  });

  it("is the same bytes whatever order the engine lists the skills in", () => {
    expect(prefixText("Instructions.", [], skills.toReversed())).toBe(
      prefixText("Instructions.", [], skills),
    );
  });

  it("lists 100 skills, then a line with the number left out", () => {
    const many = Array.from({ length: 103 }, (_unused, index) => ({
      name: `skill-${String(index).padStart(3, "0")}`,
      description: "A skill.",
      location: `installed/skill-${String(index).padStart(3, "0")}/SKILL.md`,
    }));
    const lines = prefixText("Instructions.", [], many).split("\n");
    expect(lines.filter((line) => line.startsWith("- "))).toHaveLength(indexMaxSkills);
    expect(lines.at(-1)).toBe("[3 more skills are left out of this list.]");
    expect(lines).not.toContain("- skill-100 (installed/skill-100/SKILL.md): A skill.");
  });
});
