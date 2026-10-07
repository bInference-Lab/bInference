import type { Readable, Writable } from "node:stream";
import { intro, isCancel, log, note, outro, password, text } from "@clack/prompts";
import { type Prompter, promptCancelled, type TextQuestion, withInitial } from "./prompter.js";

/** The terminal the prompter talks to: standard input and output in the entry file. */
export interface TerminalStreams {
  readonly input: Readable;
  readonly output: Writable;
}

function answered(value: string | symbol, id: string): string {
  if (isCancel(value) || typeof value === "symbol") {
    throw promptCancelled(id);
  }
  return value;
}

async function askText(streams: TerminalStreams, question: TextQuestion): Promise<string> {
  const { check, initial } = question;
  const common = {
    message: question.message,
    input: streams.input,
    output: streams.output,
    ...(check === undefined
      ? {}
      : { validate: (value: string | undefined) => check(withInitial(value, initial)) }),
  };
  const typed =
    question.isSecret === true
      ? await password({ ...common, mask: "*" })
      : await text({
          ...common,
          ...(question.placeholder === undefined ? {} : { placeholder: question.placeholder }),
        });
  return withInitial(answered(typed, question.id), initial);
}

/**
 * The prompter for a person at a terminal, over `@clack/prompts`: questions with their checks,
 * hidden input for secrets, notes and log lines on the given streams. Ctrl+C on a question
 * throws `cli.prompt_cancelled`.
 */
export function createTerminalPrompter(streams: TerminalStreams): Prompter {
  const { output } = streams;
  return {
    intro: (title) => {
      intro(title, { output });
    },
    note: (body, title) => {
      note(body, title, { output });
    },
    say: (line) => {
      log.message(line, { output });
    },
    ask: async (question) => askText(streams, question),
    outro: (line) => {
      outro(line, { output });
    },
  };
}
