import { type Prompter, promptCancelled, withInitial } from "./prompter.js";

/** What a scripted run showed, for an answer that depends on it, such as a code to type back. */
export interface Transcript {
  /** Each note, as `title` and its text. */
  readonly notes: readonly { readonly title: string; readonly text: string }[];
  /** Every line shown: intro, says, a check's problem, outro. */
  readonly lines: readonly string[];
  /** The id of each question asked, in order, once per answer taken. */
  readonly asked: readonly string[];
}

/** One answer: typed text, or text made from what the run showed so far. */
export type ScriptedAnswer = string | ((transcript: Transcript) => string);

/** A prompter for tests that answers from a script, and the transcript of what it showed. */
export interface ScriptedPrompter extends Prompter {
  readonly transcript: Transcript;
}

/**
 * Creates a prompter that answers each question from the script, in order per question id. An
 * answer the question's check refuses shows the problem and takes the next answer, as a person
 * types again. A question with no answer left is cancelled.
 */
export function createScriptedPrompter(
  script: Readonly<Record<string, readonly ScriptedAnswer[]>>,
): ScriptedPrompter {
  const notes: { title: string; text: string }[] = [];
  const lines: string[] = [];
  const asked: string[] = [];
  const left = new Map(Object.entries(script).map(([id, answers]) => [id, [...answers]]));
  const transcript: Transcript = { notes, lines, asked };
  const next = (id: string): string => {
    const answer = left.get(id)?.shift();
    if (answer === undefined) {
      throw promptCancelled(id);
    }
    asked.push(id);
    return typeof answer === "string" ? answer : answer(transcript);
  };
  return {
    transcript,
    intro: (title) => lines.push(title),
    note: (text, title) => notes.push({ title, text }),
    say: (line) => lines.push(line),
    ask: async (question) => {
      for (;;) {
        const answer = withInitial(next(question.id), question.initial);
        const problem = question.check?.(answer);
        if (problem === undefined) {
          return Promise.resolve(answer);
        }
        lines.push(problem);
      }
    },
    outro: (line) => lines.push(line),
  };
}
