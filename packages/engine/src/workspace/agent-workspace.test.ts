import { createManualClock, createMemoryWorkspaceFiles } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testAgent } from "../intents/test-intents.js";
import { makeAgentWorkspace } from "./agent-workspace.js";

const signal = new AbortController().signal;
const made = { agent: testAgent, name: "Scout", locale: "en", timeZone: "Europe/Berlin" } as const;

async function textOf(files: ReturnType<typeof createMemoryWorkspaceFiles>, file: string) {
  const read = await files.read({ agent: testAgent, file }, signal);
  return read.ok ? read.value.text : undefined;
}

describe("a new agent's workspace", () => {
  it("makes every workspace file from its template in the owner's language", async () => {
    const files = createMemoryWorkspaceFiles(createManualClock(1));
    await makeAgentWorkspace(files, made, signal);
    const texts = await Promise.all(
      ["RULES.md", "PERSONA.md", "OWNER.md", "STRATEGY.md", "NOTES.md", "FIRST-CHAT.md"].map(
        async (file) => textOf(files, file),
      ),
    );
    expect(texts.map((text) => text?.split("\n")[0])).toStrictEqual([
      "# Rules",
      "# Persona",
      "# Owner",
      "# Strategy",
      "# Notes",
      "# First chat",
    ]);
    expect(texts[0]).toContain("The rules Scout follows on every turn.");
    expect(texts[2]).toBe(
      "# Owner\n\n- Language: English\n- Time zone: Europe/Berlin\n- How to address you:\n",
    );
    expect(texts[5]).toContain(
      "8. How often should I report to you, and how short should my messages be?",
    );
  });

  it("keeps a file the agent already has", async () => {
    const files = createMemoryWorkspaceFiles(createManualClock(1));
    await files.write({ agent: testAgent, file: "STRATEGY.md" }, "Mine", signal);
    await makeAgentWorkspace(files, made, signal);
    expect(await textOf(files, "STRATEGY.md")).toBe("Mine");
  });
});
