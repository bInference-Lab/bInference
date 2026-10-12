import type { QuestionPress, QuestionStanding } from "@binference/engine/surfaces";
import type { QuestionAnswers } from "../ports.js";

/** The engine's side of question answers in memory, with handles a test drives it by. */
export interface FakeQuestionAnswers extends QuestionAnswers {
  /** Opens a question under its button reference. */
  open(ref: string): void;
  /** Closes a question as another surface, a clear or its expiry would. */
  close(ref: string): void;
  /** Every press the engine stored as an answer, in order: what the agent hears. */
  answered(): readonly QuestionPress[];
}

/**
 * Creates the engine's side of question answers in memory, for tests: the owner's first press
 * answers a question, and every later one finds it closed.
 */
export function createFakeQuestionAnswers(options: {
  readonly ownerId: number;
}): FakeQuestionAnswers {
  const open = new Map<string, boolean>();
  const answered: QuestionPress[] = [];
  const decide = (press: QuestionPress): QuestionStanding => {
    if (open.get(press.ref) !== true) {
      return { status: "closed" };
    }
    open.set(press.ref, false);
    answered.push(press);
    return { status: "answered" };
  };
  return {
    answer: async (press, call) => {
      call.signal.throwIfAborted();
      const isKnown = open.has(press.ref) && press.presserId === options.ownerId;
      return Promise.resolve(isKnown ? decide(press) : { status: "unknown" });
    },
    open: (ref) => {
      open.set(ref, true);
    },
    close: (ref) => {
      open.set(ref, false);
    },
    answered: () => [...answered],
  };
}
