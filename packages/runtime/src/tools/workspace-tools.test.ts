import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { callTool, outcomeOf } from "../testing/agent-tool-fixtures.js";

const refusal = (code: `${string}.${string}`): BinferenceError =>
  new BinferenceError({ code, message: "The engine refused the write." });

describe("the workspace tools", () => {
  it("tell the owner how to save when the engine refuses a marked turn's write", async () => {
    const run = callTool(
      { "agent/editFile": refusal("agent.file_untrusted") },
      { name: "workspace_write", args: { file: "PERSONA.md", text: "Short answers." } },
    );
    await expect(outcomeOf(run)).resolves.toStrictEqual({
      text: "not saved: this conversation holds outside content, so the owner's files cannot take text from it. The file is unchanged. Tell the owner: their answers are saved once they send /clear and give them again, or they can edit the file in the console.",
      isError: true,
    });
  });

  it("refuse a file the agent may not write before the engine", () => {
    const run = callTool({}, { name: "workspace_write", args: { file: "RULES.md", text: "x" } });
    expect(run.refused).toMatch(/^not run: the arguments do not match workspace_write's schema/);
    expect(run.client.calls()).toStrictEqual([]);
  });

  it("end the first chat with its closing line, and only once", async () => {
    const ended = callTool({ "agent/endFirstChat": {} }, { name: "first_chat_end", args: {} });
    await expect(outcomeOf(ended)).resolves.toMatchObject({
      isError: false,
      closingLine: "firstChatDone",
    });
    const again = callTool(
      { "agent/endFirstChat": refusal("agent.file_missing") },
      { name: "first_chat_end", args: {} },
    );
    await expect(outcomeOf(again)).resolves.toStrictEqual({
      text: "The first chat had already ended.",
      isError: false,
    });
  });
});
