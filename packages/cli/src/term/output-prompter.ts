import type { CliOutput } from "../program/cli-output.js";
import { type Prompter, promptCancelled } from "./prompter.js";

/**
 * The prompter of a run nobody answers, such as one with `--yes` or `--json` or without a
 * terminal: what it shows goes to the command's output as plain lines (nothing with `--json`),
 * and a question is cancelled, so every answer must come from a flag.
 */
export function createOutputPrompter(output: CliOutput): Prompter {
  return {
    intro: (title) => output.line(title),
    note: (text, title) => {
      output.line(title);
      output.line(text);
    },
    say: (line) => output.line(line),
    ask: async (question) => Promise.reject(promptCancelled(question.id)),
    outro: (line) => output.line(line),
  };
}
