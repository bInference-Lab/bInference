import { type Id, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import {
  type ChatSurface,
  chatSurfaceSchema,
  choicePlaceSchema,
  type QuestionCloseReason,
  type QuestionState,
} from "@binference/protocol";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/** How long a question stays open before it expires: 24 hours (protocol spec, section 7.7). */
export const questionOpenMs = 86_400_000;

/** The owner's answer as the store keeps it: a choice's place, or the text the owner wrote. */
export interface QuestionAnswer {
  readonly choice?: number;
  readonly typed?: string;
  readonly surface: ChatSurface;
  readonly atMs: number;
}

/** One question of the agent to the owner (database spec, `questions`). */
export interface QuestionRecord {
  readonly id: Id<"qst">;
  readonly agentId: Id<"agt">;
  readonly sessionId: Id<"ses">;
  readonly turnId: Id<"trn">;
  readonly text: string;
  readonly choices: readonly string[];
  /** The random 12-byte base64url reference its buttons carry. */
  readonly ref: string;
  readonly state: QuestionState;
  readonly answer?: QuestionAnswer;
  readonly closeReason?: QuestionCloseReason;
  readonly createdAtMs: number;
  readonly closesAtMs: number;
  readonly closedAtMs?: number;
}

const answerSchema: z.ZodType<QuestionAnswer> = z.strictObject({
  choice: choicePlaceSchema.exactOptional(),
  typed: z.string().exactOptional(),
  surface: chatSurfaceSchema,
  atMs: epochMsSchema,
});

/** A question's button reference: 12 random bytes in base64url. */
export const questionRefSchema: z.ZodType<string, string> = z
  .string()
  .regex(/^[\w-]{16}$/, { message: "Expected 12 bytes in base64url." });

/** Parses a question as a store keeps it. */
export const questionRecordSchema: z.ZodType<QuestionRecord> = z.strictObject({
  id: idSchema("qst"),
  agentId: idSchema("agt"),
  sessionId: idSchema("ses"),
  turnId: idSchema("trn"),
  text: z.string().min(1),
  choices: z.array(z.string().min(1)).min(2).max(4),
  ref: questionRefSchema,
  state: z.enum(["open", "answered", "closed"]),
  answer: answerSchema.exactOptional(),
  closeReason: z.enum(["replaced", "cleared", "expired"]).exactOptional(),
  createdAtMs: epochMsSchema,
  closesAtMs: epochMsSchema,
  closedAtMs: epochMsSchema.exactOptional(),
});

/** Whether a question still takes an answer at a time: open and not yet expired. */
export function isAnswerable(question: QuestionRecord, atMs: number): boolean {
  return question.state === "open" && atMs < question.closesAtMs;
}

/**
 * The owner's answer to a question, with the `inbox/message` the same write stores for the agent
 * runtime: its id, the turn reserved for it, the session it opens when none is open, and its
 * payload.
 */
export interface QuestionAnswerDraft {
  readonly questionId: Id<"qst">;
  readonly answer: QuestionAnswer;
  readonly message: {
    readonly id: Id<"msg">;
    readonly turnId: Id<"trn">;
    readonly opens: Id<"ses">;
    readonly payload: JsonValue;
  };
}

/** Parses an answer draft. */
export const questionAnswerDraftSchema: z.ZodType<QuestionAnswerDraft> = z.strictObject({
  questionId: idSchema("qst"),
  answer: answerSchema,
  message: z.strictObject({
    id: idSchema("msg"),
    turnId: idSchema("trn"),
    opens: idSchema("ses"),
    payload: jsonValueSchema,
  }),
});

/** A question closed without an answer, from a clear or its expiry. */
export interface QuestionClosing {
  readonly questionId: Id<"qst">;
  readonly reason: "cleared" | "expired";
  readonly atMs: number;
}

/** Parses a closing. */
export const questionClosingSchema: z.ZodType<QuestionClosing> = z.strictObject({
  questionId: idSchema("qst"),
  reason: z.enum(["cleared", "expired"]),
  atMs: epochMsSchema,
});

/** One surface's copy of a question (database spec, `question_messages`). */
export interface QuestionCopy {
  readonly questionId: Id<"qst">;
  readonly surface: "telegram" | "console" | "mini";
  readonly chatId: number;
  readonly topicId?: number;
  readonly messageId: number;
  readonly sentAtMs: number;
}

/** Parses a question copy. */
export const questionCopySchema: z.ZodType<QuestionCopy> = z.strictObject({
  questionId: idSchema("qst"),
  surface: z.enum(["telegram", "console", "mini"]),
  chatId: z.int(),
  topicId: z.int().positive().exactOptional(),
  messageId: z.int().positive(),
  sentAtMs: epochMsSchema,
});
