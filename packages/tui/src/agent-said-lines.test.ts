import { describe, expect, it } from "vitest";
import { agentSaidLines } from "./chat-lines.js";

describe("the agent's Markdown in the terminal", () => {
  it("leaves its marks out, puts a quote behind a bar and indents a code block", () => {
    const text = "Send **0.5 BNB** to `0xabc`.\n\n> Paper mode\n\n```\nls -l\n```";
    expect(agentSaidLines("main", text).map((line) => line.text)).toStrictEqual([
      "main: Send 0.5 BNB to 0xabc.",
      "  ",
      "  │ Paper mode",
      "  ",
      "      ls -l",
    ]);
  });
});
