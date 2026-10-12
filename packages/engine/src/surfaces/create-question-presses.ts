import type { ProtocolErrorCode } from "@binference/protocol";
import type { QuestionStore } from "../chat/ports.js";
import type { OwnerCalls } from "./create-owner-calls.js";
import { type OwnerIdOf, pressedByOwner } from "./pressed-by-owner.js";

/** The owner's press of a button of the agent's question in Telegram, as the engine receives it. */
export interface QuestionPress {
  /** The question's button reference, from the button's data. */
  readonly ref: string;
  /** The place of the choice pressed, `0` to `3`. */
  readonly choice: number;
  /** The presser's numeric Telegram id; the engine answers only for the owner's. */
  readonly presserId: number;
}

/**
 * How a question stands after a press. `answered`: this press answered it, and its answer went to
 * the agent. `closed`: it was answered or closed before, and the press changed nothing.
 * `refused`: the engine refused the answer with a code, such as a full inbox. `unknown`: no
 * question has this reference, or the presser is not the owner; nothing was answered.
 */
export type QuestionStanding =
  | { readonly status: "answered" }
  | { readonly status: "closed" }
  | { readonly status: "refused"; readonly error: ProtocolErrorCode }
  | { readonly status: "unknown" };

/** The engine's side of the owner's presses of question buttons in Telegram. */
export interface QuestionPresses {
  /** Answers a question for a press and says how it stands. Rejects once the signal aborts. */
  answer(
    press: QuestionPress,
    options: { readonly signal: AbortSignal },
  ): Promise<QuestionStanding>;
}

/** What {@link createQuestionPresses} reads and answers through. */
export interface QuestionPressesOptions {
  readonly questions: Pick<QuestionStore, "byRef">;
  /** Runs `chat/answer` as the owner on Telegram, for the owner's numeric Telegram id alone. */
  readonly calls: OwnerCalls;
  /** The owner's numeric Telegram id, or `undefined` before the owner pairs. */
  readonly ownerId: OwnerIdOf;
}

const unknown: QuestionStanding = { status: "unknown" };

/**
 * Creates the {@link QuestionPresses}, the engine's adapter of Telegram's `QuestionAnswers` port. A
 * press by anyone but the owner, or on a reference no question has, answers nothing. The owner's
 * press runs `chat/answer`, whose one write closes the question and stores its answer, so the
 * answer reaches the agent once (spec 4, section 2).
 */
export function createQuestionPresses(options: QuestionPressesOptions): QuestionPresses {
  return {
    async answer(press, { signal }) {
      const question = (await pressedByOwner(options.ownerId, press.presserId, signal))
        ? await options.questions.byRef(press.ref, { signal })
        : undefined;
      if (question === undefined) {
        return unknown;
      }
      const args = { agent: question.agentId, question: question.id, choice: press.choice };
      const answered = await options.calls.call(
        { op: "chat/answer", args, senderId: press.presserId },
        { signal },
      );
      if (answered.ok) {
        return { status: "answered" };
      }
      return answered.error === "question.closed"
        ? { status: "closed" }
        : { status: "refused", error: answered.error };
    },
  };
}
