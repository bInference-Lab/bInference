import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import {
  type QuestionAnswerView,
  questionAnswerViewSchema,
  type QuestionCloseReason,
  questionCloseReasonSchema,
  type QuestionState,
  questionStateSchema,
  type QuestionView,
  questionViewSchema,
} from "./question-view.schema.js";

/** How a question ended, as `chat/questionClosed` carries it. */
export interface QuestionClosedPush {
  readonly kind: "chat/questionClosed";
  readonly question: ProtocolId<"question">;
  readonly state: QuestionState;
  readonly answer?: QuestionAnswerView;
  readonly closeReason?: QuestionCloseReason;
}

/** A push of an agent's chat topic about its question (protocol spec, section 7.7). */
export type QuestionPush =
  | { readonly kind: "chat/question"; readonly view: QuestionView }
  | QuestionClosedPush;

const closedSchema = z.object({
  question: protocolIdSchema("question"),
  state: questionStateSchema,
  answer: questionAnswerViewSchema.exactOptional(),
  closeReason: questionCloseReasonSchema.exactOptional(),
});

/**
 * Reads a push of an agent's chat topic as a {@link QuestionPush}: `chat/question` with the
 * question, or `chat/questionClosed` with how it ended. `undefined` for any other push, and for
 * one in a shape it cannot read.
 */
export function questionPushOf(push: {
  readonly kind: string;
  readonly data: unknown;
}): QuestionPush | undefined {
  if (push.kind === "chat/question") {
    const view = questionViewSchema.safeParse(push.data);
    return view.success ? { kind: push.kind, view: view.data } : undefined;
  }
  if (push.kind !== "chat/questionClosed") {
    return undefined;
  }
  const closed = closedSchema.safeParse(push.data);
  return closed.success ? { kind: push.kind, ...closed.data } : undefined;
}
