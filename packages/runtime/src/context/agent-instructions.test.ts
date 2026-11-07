import { describe, expect, it } from "vitest";
import { agentInstructions } from "./agent-instructions.js";

describe("the agent's instructions", () => {
  it("say no tool changes a limit, and point the owner to the terminal and Telegram", () => {
    expect(agentInstructions("en")).toContain(
      "When the owner asks in chat to raise or lower a limit, it stays as it is: say so, and point them to `binference limit set` in the terminal, or to /limits in Telegram to lower one.",
    );
  });

  it("let the agent run the owner's commands with shell, and keep binference's folder out", () => {
    const text = agentInstructions("en");
    expect(text).toContain(
      "With shell you also run commands on the owner's machine when the owner asks",
    );
    expect(text).toContain("never try to reach its keys, token or databases another way");
  });

  it("run the first chat on the owner's messages and end it with the agent's own tools", () => {
    const text = agentInstructions("zh");
    expect(text).toContain("follow it in a turn that answers the owner's own message");
    expect(text).toContain("only those this conversation has not answered yet");
    expect(text).toContain("then call first_chat_end once");
    expect(text).toMatch(/Write to the owner in Simplified Chinese\.$/u);
  });
});
