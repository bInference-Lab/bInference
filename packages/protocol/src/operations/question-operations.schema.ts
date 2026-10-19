import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import type { AgentArgs } from "../values/agent-args.schema.js";
import {
  choicePlaceSchema,
  questionLimits,
  type QuestionView,
  questionViewSchema,
} from "../views/question-view.schema.js";
import type { TurnRef } from "./chat-operations.schema.js";
import { readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

/**
 * The args of `turn/ask`: the agent's question in its running turn, with 2 to 4 answer buttons
 * (protocol spec, section 7.7).
 */
interface AskArgs extends AgentArgs, TurnRef {
  readonly text: string;
  readonly choices: readonly string[];
}

/** The args of `chat/answer`: the owner picks a choice of an open question by its place. */
interface AnswerArgs extends AgentArgs {
  readonly question: ProtocolId<"question">;
  readonly choice: number;
}

/** What `chat/openQuestion` answers: the agent's open question, or none. */
interface OpenQuestion {
  readonly question?: QuestionView;
}

/** The operations of the agent's questions to the owner. */
export interface QuestionOperationShapes {
  readonly "turn/ask": { readonly args: AskArgs; readonly result: QuestionView };
  readonly "chat/answer": { readonly args: AnswerArgs; readonly result: TurnRef };
  readonly "chat/openQuestion": { readonly args: AgentArgs; readonly result: OpenQuestion };
}

const agent = protocolIdSchema("agent");

// The status icons of spec 4, section 1: a choice may not open with one, so a question never
// looks like a card.
const statusIcons = /^[\u{1F7E1}\u{2705}\u{274C}\u{26A0}\u{1F9EA}\u{1F534}]/u;
const choiceLabel = z
  .string()
  .min(1)
  .max(questionLimits.choice)
  .regex(/^[^\r\n]+$/)
  .refine((label) => !statusIcons.test(label), { message: "A choice may not open with an icon." });
/**
 * Parses a question's choices: 2 to 4 distinct labels, each one line of 1 to 64 characters that
 * never opens with a status icon, so a question never looks like a card.
 */
export const questionChoicesSchema: z.ZodType<readonly string[]> = z
  .array(choiceLabel)
  .min(questionLimits.minChoices)
  .max(questionLimits.maxChoices)
  .refine((labels: readonly string[]) => new Set(labels).size === labels.length, {
    message: "Each choice is distinct.",
  });

/** The operations of the agent's questions, by name. */
export const questionOperations: OperationTable<QuestionOperationShapes> = {
  "turn/ask": {
    ...writeFlags,
    name: "turn/ask",
    scope: "agent",
    args: z.strictObject({
      agent,
      session: protocolIdSchema("chatSession"),
      turn: protocolIdSchema("chatTurn"),
      text: z.string().min(1).max(questionLimits.text),
      choices: questionChoicesSchema,
    }),
    result: questionViewSchema,
  },
  "chat/answer": {
    ...writeFlags,
    name: "chat/answer",
    scope: "chat",
    args: z.strictObject({
      agent,
      question: protocolIdSchema("question"),
      choice: choicePlaceSchema,
    }),
    result: z.object({
      session: protocolIdSchema("chatSession"),
      turn: protocolIdSchema("chatTurn"),
    }),
  },
  "chat/openQuestion": {
    ...readFlags,
    name: "chat/openQuestion",
    scope: "read",
    args: z.strictObject({ agent }),
    result: z.object({ question: questionViewSchema.exactOptional() }),
  },
};
