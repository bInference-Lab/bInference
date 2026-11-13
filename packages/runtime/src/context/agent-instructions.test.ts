import { describe, expect, it } from "vitest";
import { agentInstructions } from "./agent-instructions.js";

describe("the agent's instructions", () => {
  it("say no tool changes a limit, and point the owner to the console, the terminal and Telegram", () => {
    expect(agentInstructions("en")).toContain(
      "When the owner asks in chat to raise or lower a limit, it stays as it is: say so, and point them to the Limits screen of the console or the Mini App, or to `binference limit set` in the terminal; /limits in Telegram lowers one.",
    );
  });

  it("let the agent run the owner's commands with shell, and keep binference's folder out", () => {
    const text = agentInstructions("en");
    expect(text).toContain(
      "With shell you also run commands on the owner's machine when the owner asks",
    );
    expect(text).toContain("never try to reach its keys, token or databases another way");
  });

  it("let the agent drive its own browser, never with the owner's secrets", () => {
    const text = agentInstructions("en");
    expect(text).toContain("With browse you drive a browser of your own on the owner's machine");
    expect(text).toContain("Never type the owner's passwords, keys or card numbers into a page");
  });

  it("tell the agent never to repeat what a tool showed the owner", () => {
    expect(agentInstructions("en")).toContain(
      "the owner already sees: never repeat it in your answer",
    );
  });

  it("give the Markdown every surface renders and a style for a phone, before the language", () => {
    const text = agentInstructions("en");
    expect(text).toContain("## How you write");
    expect(text).toContain("Put every address, transaction hash, command and file name in `code`");
    expect(text).toContain("When nothing is left to say, write nothing.");
    expect(text.indexOf("## How you write")).toBeLessThan(
      text.indexOf("Write to the owner in English."),
    );
  });

  it("run the first chat on the owner's messages and end it with the agent's own tools", () => {
    const text = agentInstructions("zh");
    expect(text).toContain("a short introduction, never a gate");
    expect(text).toContain(
      "do it completely and answer only that, with no first-chat question added",
    );
    expect(text).toContain("only one this conversation has not answered yet");
    expect(text).toContain("call first_chat_end once, and ask none of its questions again");
    expect(text).toMatch(/Write to the owner in Simplified Chinese\.$/u);
  });
});
