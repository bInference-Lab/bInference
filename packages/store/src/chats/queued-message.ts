import { type Id, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import { fenceSchema, type Fenced } from "./fenced.js";

/** The kinds of the agent inbox's messages (runtime spec, section 3.3). */
export type InboxKind =
  | "inbox/message"
  | "inbox/intentSettled"
  | "inbox/orderSettled"
  | "inbox/scheduleDue"
  | "inbox/alertFired"
  | "inbox/resumeReport"
  | "inbox/stop"
  | "inbox/clear";

/** A message the runtime took from the agent inbox into its chat queue. */
export interface QueuedMessage {
  readonly message: Id<"msg">;
  readonly agentId: Id<"agt">;
  readonly sessionId: Id<"ses">;
  readonly kind: InboxKind;
  /** The message's data, as the engine pushed it. */
  readonly payload: JsonValue;
  readonly receivedAtMs: number;
  /** The turn that took it. */
  readonly turnId?: Id<"trn">;
  readonly droppedAtMs?: number;
  /** Why it was dropped, such as `budget`. */
  readonly dropReason?: string;
}

/** A message as it joins the queue. */
export type QueueDraft = Pick<
  QueuedMessage,
  "message" | "agentId" | "sessionId" | "kind" | "payload" | "receivedAtMs"
>;

/** The messages a turn takes, oldest first, all or none. */
export interface QueueTake {
  readonly messages: readonly Id<"msg">[];
  readonly turn: Id<"trn">;
}

/** A message dropped with its reason. */
export interface QueueDrop {
  readonly message: Id<"msg">;
  readonly atMs: number;
  readonly reason: string;
}

/**
 * Which messages wait: no turn took them and none was dropped, oldest first. With no session,
 * those of every session, as a runtime reads them again at its start.
 */
export interface WaitingQuery {
  readonly sessionId?: Id<"ses">;
  readonly limit: number;
}

/** A queued message as the turn that took it holds it. */
export function takenBy(message: QueuedMessage, turn: Id<"trn">): QueuedMessage {
  return { ...message, turnId: turn };
}

const epochMs = z.int().nonnegative();
const reasonSchema = z.string().min(1).max(64);
const kindSchema = z.enum([
  "inbox/message",
  "inbox/intentSettled",
  "inbox/orderSettled",
  "inbox/scheduleDue",
  "inbox/alertFired",
  "inbox/resumeReport",
  "inbox/stop",
  "inbox/clear",
]);
const draftShape = {
  message: idSchema("msg"),
  agentId: idSchema("agt"),
  sessionId: idSchema("ses"),
  kind: kindSchema,
  payload: jsonValueSchema,
  receivedAtMs: epochMs,
};

/** Parses a queued message. */
export const queuedMessageSchema: z.ZodType<QueuedMessage> = z.strictObject({
  ...draftShape,
  turnId: idSchema("trn").exactOptional(),
  droppedAtMs: epochMs.exactOptional(),
  dropReason: reasonSchema.exactOptional(),
});

/** Parses a fenced queue draft. */
export const queueDraftSchema: z.ZodType<Fenced<QueueDraft>> = z.strictObject({
  ...draftShape,
  fence: fenceSchema,
});

/** Parses a fenced take: 1 to 20 messages, the most one turn takes. */
export const queueTakeSchema: z.ZodType<Fenced<QueueTake>> = z.strictObject({
  messages: z.array(idSchema("msg")).min(1).max(20),
  turn: idSchema("trn"),
  fence: fenceSchema,
});

/** Parses a fenced drop. */
export const queueDropSchema: z.ZodType<Fenced<QueueDrop>> = z.strictObject({
  message: idSchema("msg"),
  atMs: epochMs,
  reason: reasonSchema,
  fence: fenceSchema,
});

/** Parses a waiting query: at most 200 of one session, or 1,000 of every session. */
export const waitingQuerySchema: z.ZodType<WaitingQuery> = z
  .strictObject({
    sessionId: idSchema("ses").exactOptional(),
    limit: z.int().min(1).max(1_000),
  })
  .refine((query) => query.sessionId === undefined || query.limit <= 200, {
    message: "One session's waiting messages are read 200 at most.",
  });
