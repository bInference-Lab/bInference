import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { Prompter } from "./prompter.js";
import { createTerminalPrompter } from "./terminal-prompter.js";

interface Terminal {
  readonly prompter: Prompter;
  /** Types keys into the terminal's input. */
  readonly type: (keys: string) => void;
  /** Everything written to the terminal so far. */
  readonly screen: () => string;
}

function terminal(): Terminal {
  const input = new PassThrough();
  const output = new PassThrough();
  const written: Buffer[] = [];
  output.on("data", (chunk: Buffer) => written.push(chunk));
  return {
    prompter: createTerminalPrompter({ input, output }),
    type: (keys) => input.write(keys),
    screen: () => Buffer.concat(written).toString("utf8"),
  };
}

function onlyDigits(typed: string): string | undefined {
  return /^\d+$/.test(typed) ? undefined : "Only digits.";
}

// Types each key once the prompt has started reading: a prompt reads only after it renders.
async function answer(term: Terminal, asking: Promise<string>, keys: string): Promise<string> {
  await Promise.resolve();
  term.type(keys);
  return asking;
}

describe("the terminal prompter", () => {
  it("asks a question and gives the typed line", async () => {
    const term = terminal();
    const asking = term.prompter.ask({ id: "name", message: "Your bot's name?" });
    await expect(answer(term, asking, "binference\r")).resolves.toBe("binference");
    expect(term.screen()).toContain("Your bot's name?");
  });

  it("gives the initial answer for Enter alone", async () => {
    const term = terminal();
    const asking = term.prompter.ask({ id: "cap", message: "Cap?", initial: "100" });
    await expect(answer(term, asking, "\r")).resolves.toBe("100");
  });

  it("shows a check's problem and waits for a line it takes", async () => {
    const term = terminal();
    const asking = term.prompter.ask({
      id: "digits",
      message: "Digits?",
      check: onlyDigits,
    });
    await Promise.resolve();
    term.type("ab\r");
    term.type("\b\b12\r");
    await expect(asking).resolves.toBe("12");
    expect(term.screen()).toContain("Only digits.");
  });

  it("hides a secret as it is typed", async () => {
    const term = terminal();
    const asking = term.prompter.ask({ id: "secret", message: "Secret?", isSecret: true });
    await expect(answer(term, asking, "hunter2\r")).resolves.toBe("hunter2");
    expect(term.screen()).not.toContain("hunter2");
  });

  it("throws the cancel fault on Ctrl+C", async () => {
    const term = terminal();
    const asking = term.prompter.ask({ id: "cancelled", message: "Anything?" });
    await expect(answer(term, asking, "\u0003")).rejects.toMatchObject({
      code: "cli.prompt_cancelled",
      details: { question: "cancelled" },
    });
  });

  it("writes the intro, notes, lines and outro to the terminal", () => {
    const term = terminal();
    term.prompter.intro("Set up binference");
    term.prompter.note("bnok1abcde fghij", "Owner key");
    term.prompter.say("Checked.");
    term.prompter.outro("Done.");
    expect(term.screen()).toMatch(/Set up binference[\s\S]*Owner key[\s\S]*Checked\.[\s\S]*Done\./);
  });
});
