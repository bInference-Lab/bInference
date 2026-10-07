import { BinferenceError } from "@binference/core";

/** A question answered with a line of text. */
export interface TextQuestion {
  /** Names the question, so a scripted run can answer it. */
  readonly id: string;
  /** The question in the owner's language. */
  readonly message: string;
  readonly placeholder?: string;
  /** The answer when the person only presses Enter. */
  readonly initial?: string;
  /** Hides what is typed: for an app secret, a bot token or a passphrase. */
  readonly isSecret?: boolean;
  /** The problem with an answer in the owner's language, or `undefined` when it is taken. */
  readonly check?: (answer: string) => string | undefined;
}

/**
 * Asks the person at the terminal, and shows them what happens. Every text it takes is already
 * in the owner's language. A question the person cancels, or one nobody can answer, throws
 * `cli.prompt_cancelled`.
 */
export interface Prompter {
  /** Opens the session with its title. */
  intro(title: string): void;
  /** Shows a block of text under a title, such as steps to follow or a code to write down. */
  note(text: string, title: string): void;
  /** Shows one line: a step done, or what went wrong. */
  say(text: string): void;
  ask(question: TextQuestion): Promise<string>;
  /** Closes the session with its last line. */
  outro(text: string): void;
}

/** The fault for a question the person cancelled, or one nobody is there to answer. */
export function promptCancelled(question: string): BinferenceError {
  return new BinferenceError({
    code: "cli.prompt_cancelled",
    message: "The question was cancelled; nothing after it ran.",
    details: { question },
  });
}

/** An empty answer stands for the question's initial answer, as Enter does in the terminal. */
export function withInitial(answer: string | undefined, initial: string | undefined): string {
  return answer === undefined || answer === "" ? (initial ?? "") : answer;
}
