import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type ChatSurface, chatSurfaceSchema } from "./inbox-message-view.schema.js";

/** How far a question of the agent got: open, answered by the owner, or closed without one. */
export type QuestionState = "open" | "answered" | "closed";

/** Why a question closed without an answer. */
export type QuestionCloseReason = "replaced" | "cleared" | "expired";

/** The owner's answer: the place of the choice pressed, or the text the owner wrote instead. */
export interface QuestionAnswerView {
  readonly choice?: number;
  readonly typed?: string;
  readonly surface: ChatSurface;
  readonly at: number;
}

/**
 * The agent's question to the owner (protocol spec, section 7.7): its words, its 2 to 4 choices,
 * how far it got, and when it expires.
 */
export interface QuestionView {
  readonly question: ProtocolId<"question">;
  readonly agent: ProtocolId<"agent">;
  readonly session: ProtocolId<"chatSession">;
  readonly turn: ProtocolId<"chatTurn">;
  readonly text: string;
  readonly choices: readonly string[];
  readonly state: QuestionState;
  readonly answer?: QuestionAnswerView;
  readonly closeReason?: QuestionCloseReason;
  readonly createdAt: number;
  readonly closesAt: number;
}

/** The most words a question holds, and the most characters of each choice. */
export const questionLimits = { text: 500, choice: 64, minChoices: 2, maxChoices: 4 } as const;

/** Parses the place of a choice in its question. */
export const choicePlaceSchema: z.ZodInt = z
  .int()
  .min(0)
  .max(questionLimits.maxChoices - 1);

/** Parses a question's state. */
export const questionStateSchema: z.ZodType<QuestionState, string> = z.enum([
  "open",
  "answered",
  "closed",
]);

/** Parses why a question closed. */
export const questionCloseReasonSchema: z.ZodType<QuestionCloseReason, string> = z.enum([
  "replaced",
  "cleared",
  "expired",
]);

/** Parses the owner's answer to a question. */
export const questionAnswerViewSchema: z.ZodType<QuestionAnswerView> = z.object({
  choice: choicePlaceSchema.exactOptional(),
  typed: z.string().exactOptional(),
  surface: chatSurfaceSchema,
  at: epochMsSchema,
});

/** Parses a question view. */
export const questionViewSchema: z.ZodType<QuestionView> = z.object({
  question: protocolIdSchema("question"),
  agent: protocolIdSchema("agent"),
  session: protocolIdSchema("chatSession"),
  turn: protocolIdSchema("chatTurn"),
  text: z.string(),
  choices: z.array(z.string()),
  state: questionStateSchema,
  answer: questionAnswerViewSchema.exactOptional(),
  closeReason: questionCloseReasonSchema.exactOptional(),
  createdAt: epochMsSchema,
  closesAt: epochMsSchema,
});
