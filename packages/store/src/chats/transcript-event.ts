import { type Id, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import { fenceSchema, type Fenced } from "./fenced.js";

/** Who an event is from. */
export type EventRole = "owner" | "agent" | "tool" | "system";

/** What an event holds. */
export type EventKind = "text" | "tool_call" | "tool_result" | "image" | "summary";

/** One event of a session's transcript, which never changes once written. */
export interface TranscriptEvent {
  /** The store's own number for it. */
  readonly id: number;
  readonly sessionId: Id<"ses">;
  readonly turnId?: Id<"trn">;
  /** Its place in the session, from 1, with no gap. */
  readonly seq: number;
  readonly role: EventRole;
  readonly kind: EventKind;
  readonly content: JsonValue;
  /** It holds outside content (runtime spec, section 5.4). */
  readonly outside: boolean;
  readonly atMs: number;
}

/** An event as it is appended; the store numbers it. */
export type EventDraft = Omit<TranscriptEvent, "id" | "sessionId" | "seq">;

/** Events appended to one session in one write, in order. */
export interface EventAppend {
  readonly sessionId: Id<"ses">;
  readonly events: readonly EventDraft[];
}

/**
 * Events of one turn appended with that turn's committed mark, in one write (runtime spec,
 * section 6.1): a propose call is stored with the mark before the engine hears of it.
 */
export interface CommittingAppend extends EventAppend {
  /** The turn whose mark the write sets; every event names it. */
  readonly turn: Id<"trn">;
}

/** Which of a session's events to read: those after `afterSeq`, in order, at most `limit`. */
export interface EventQuery {
  readonly sessionId: Id<"ses">;
  readonly afterSeq?: number;
  readonly limit: number;
}

const epochMs = z.int().nonnegative();
const draftShape = {
  turnId: idSchema("trn").exactOptional(),
  role: z.enum(["owner", "agent", "tool", "system"]),
  kind: z.enum(["text", "tool_call", "tool_result", "image", "summary"]),
  content: jsonValueSchema,
  outside: z.boolean(),
  atMs: epochMs,
};

/** Parses a transcript event. */
export const transcriptEventSchema: z.ZodType<TranscriptEvent> = z.strictObject({
  id: z.int().positive(),
  sessionId: idSchema("ses"),
  seq: z.int().positive(),
  ...draftShape,
});

/** Parses a fenced append: 1 to 100 events. */
export const eventAppendSchema: z.ZodType<Fenced<EventAppend>> = z.strictObject({
  sessionId: idSchema("ses"),
  events: z.array(z.strictObject(draftShape)).min(1).max(100),
  fence: fenceSchema,
});

/** Parses a fenced committing append: 1 to 100 events of one turn. */
export const committingAppendSchema: z.ZodType<Fenced<CommittingAppend>> = z.strictObject({
  sessionId: idSchema("ses"),
  turn: idSchema("trn"),
  events: z.array(z.strictObject(draftShape)).min(1).max(100),
  fence: fenceSchema,
});

/** Parses an event query. */
export const eventQuerySchema: z.ZodType<EventQuery> = z.strictObject({
  sessionId: idSchema("ses"),
  afterSeq: z.int().nonnegative().exactOptional(),
  limit: z.int().min(1).max(1_000),
});
