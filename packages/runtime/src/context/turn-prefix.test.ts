import { describe, expect, it } from "vitest";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { createMemoryContextSource } from "../testing/memory-context-source.js";
import { fileMaxChars, prefixText, readTurnPrefix, workspaceMaxChars } from "./turn-prefix.js";

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
