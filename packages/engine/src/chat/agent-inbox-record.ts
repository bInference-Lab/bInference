import { type Id, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, pageLimitSchema } from "../records/record-fields.js";

/** The kinds of agent inbox message the engine writes today (runtime spec, section 3.3). */
const agentInboxKinds = [
  "inbox/message",
  "inbox/intentSettled",
  "inbox/stop",
  "inbox/clear",
  "inbox/scheduleDue",
  "inbox/alertFired",
  "inbox/resumeReport",
] as const;

/** One kind of agent inbox message, named as its `inbox` push. */
export type AgentInboxKind = (typeof agentInboxKinds)[number];

/**
 * The kinds written on their own: an owner's chat's, and the downtime re-check's report; a settle
 * message is written only with its intent's move, and a wake-up only with its schedule's run or
 * its alert's fire.
 */
type OwnerInboxKind = Exclude<
  AgentInboxKind,
  "inbox/intentSettled" | "inbox/scheduleDue" | "inbox/alertFired"
>;

/** Whether a message only wakes the agent: a turn of these alone waits while it is frozen. */
export function isWakeUp(kind: AgentInboxKind): boolean {
  return kind === "inbox/scheduleDue" || kind === "inbox/alertFired";
}

/**
 * Untaken messages one agent may hold (runtime spec, section 3.2). Past it, an owner's message is
 * refused and a message the engine makes is dropped.
 */
export const maxUntakenMessages = 200;

/**
 * Whether a message waits for room in the agent's inbox: an owner's message is refused and a
 * resume report dropped past {@link maxUntakenMessages}; a stop or a clear always lands.
 */
export function needsRoom(kind: AgentInboxKind): boolean {
  return kind === "inbox/message" || kind === "inbox/resumeReport";
}

/**
 * A message the owner's chat, or the downtime re-check, writes for the agent runtime. It lands in
 * the agent's open session, and opens `opens` when none is open; `next`, for a clear, becomes the
 * open session after it.
 */
export interface AgentInboxDraft {
  readonly id: Id<"msg">;
  readonly agentId: Id<"agt">;
  readonly kind: OwnerInboxKind;
  /** The turn the engine reserved for a message that can start one. */
  readonly turnId?: Id<"trn">;
  /** The kind's own fields, as the `inbox` push carries them. */
  readonly payload: JsonValue;
  readonly atMs: number;
  readonly opens: Id<"ses">;
  readonly next?: Id<"ses">;
}

/** Parses an agent inbox draft. */
export const agentInboxDraftSchema: z.ZodType<AgentInboxDraft> = z.strictObject({
  id: idSchema("msg"),
  agentId: idSchema("agt"),
  kind: z.enum(["inbox/message", "inbox/stop", "inbox/clear", "inbox/resumeReport"]),
  turnId: idSchema("trn").exactOptional(),
  payload: jsonValueSchema,
  atMs: epochMsSchema,
  opens: idSchema("ses"),
  next: idSchema("ses").exactOptional(),
});

/** One stored message of `agent_inbox`; `takenAtMs` is set once the runtime holds it. */
export interface AgentInboxMessage {
  readonly id: Id<"msg">;
  readonly agentId: Id<"agt">;
  readonly sessionId: Id<"ses">;
  readonly kind: AgentInboxKind;
  readonly turnId?: Id<"trn">;
  readonly payload: JsonValue;
  readonly createdAtMs: number;
  readonly takenAtMs?: number;
}

/** Parses a stored agent inbox message. */
export const agentInboxMessageSchema: z.ZodType<AgentInboxMessage> = z.strictObject({
  id: idSchema("msg"),
  agentId: idSchema("agt"),
  sessionId: idSchema("ses"),
  kind: z.enum(agentInboxKinds),
  turnId: idSchema("trn").exactOptional(),
  payload: jsonValueSchema,
  createdAtMs: epochMsSchema,
  takenAtMs: epochMsSchema.exactOptional(),
});

/**
 * Which untaken messages to list: one agent's or every agent's, the oldest first, after `after`
 * when given, so the runtime pages through them.
 */
export interface UntakenQuery {
  readonly agentId?: Id<"agt">;
  readonly after?: { readonly createdAtMs: number; readonly id: Id<"msg"> };
  readonly limit: number;
}

/** Parses an untaken query. */
export const untakenQuerySchema: z.ZodType<UntakenQuery> = z.strictObject({
  agentId: idSchema("agt").exactOptional(),
  after: z.strictObject({ createdAtMs: epochMsSchema, id: idSchema("msg") }).exactOptional(),
  limit: pageLimitSchema,
});

/** The messages the runtime took into its chat queue, and when. */
export interface InboxTake {
  readonly ids: readonly Id<"msg">[];
  readonly atMs: number;
}

/** Parses a take. */
export const inboxTakeSchema: z.ZodType<InboxTake> = z.strictObject({
  ids: z.array(idSchema("msg")).min(1).max(1_000),
  atMs: epochMsSchema,
});

/** The ids a settle message carries, all from its intent's, so an intent settles once. */
export interface SettleIds {
  readonly message: Id<"msg">;
  readonly turn: Id<"trn">;
  /** The session the message opens when its agent has none open. */
  readonly session: Id<"ses">;
}

/**
 * The ids of the settle message of an intent: its id's UUID under the message, turn and session
 * prefixes. An intent settles once, so its message id is never used twice.
 */
export function settleIdsOf(intent: Id<"int">): SettleIds {
  const uuid = intent.slice("int_".length);
  return {
    message: idSchema("msg").parse(`msg_${uuid}`),
    turn: idSchema("trn").parse(`trn_${uuid}`),
    session: idSchema("ses").parse(`ses_${uuid}`),
  };
}

/**
 * Whether an intent was proposed by the agent runtime, from the cause its first event records:
 * the engine names the proposer's role there, `agent_runtime` for a caller with the `agent` scope.
 */
export function isRuntimeProposal(firstCause: JsonValue): boolean {
  return (
    typeof firstCause === "object" &&
    firstCause !== null &&
    !Array.isArray(firstCause) &&
    "proposer" in firstCause &&
    firstCause["proposer"] === "agent_runtime"
  );
}
