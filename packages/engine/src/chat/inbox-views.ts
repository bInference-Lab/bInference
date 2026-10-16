import { BinferenceError, type Id, jsonValueSchema, type JsonValue } from "@binference/core";
import {
  type InboxMessageView,
  inboxMessageViewSchema,
  type IntentView,
} from "@binference/protocol";
import type { AgentInboxMessage } from "./agent-inbox-record.js";
import {
  clearPayloadSchema,
  ownerMessagePayloadSchema,
  scheduleDuePayloadSchema,
  settlePayloadSchema,
  stopPayloadSchema,
} from "./inbox-payload.schema.js";

/** Reads an intent's view as the engine answers `intent/get`; `undefined` for an unknown one. */
export type IntentViewOf = (
  intent: Id<"int">,
  signal: AbortSignal,
) => Promise<IntentView | undefined>;

function turnOf(message: AgentInboxMessage): Id<"trn"> {
  if (message.turnId === undefined) {
    throw new BinferenceError({
      code: "engine.inbox_turn_missing",
      message: `Inbox message ${message.id} can start a turn but has none reserved.`,
      details: { message: message.id },
    });
  }
  return message.turnId;
}

/**
 * A stored inbox message as `inbox/list` and the `inbox` topic carry it (runtime spec, section
 * 3.3): a settle message with its intent's view as it stands now, and a schedule's wake-up with
 * its prompt and mark.
 */
export async function inboxViewOf(
  message: AgentInboxMessage,
  intentView: IntentViewOf,
  signal: AbortSignal,
): Promise<InboxMessageView> {
  const base = {
    message: message.id,
    agent: message.agentId,
    session: message.sessionId,
    at: message.createdAtMs,
  };
  if (message.kind === "inbox/message") {
    const payload = ownerMessagePayloadSchema.parse(message.payload);
    return { ...base, kind: message.kind, turn: turnOf(message), ...payload };
  }
  if (message.kind === "inbox/stop") {
    return { ...base, kind: message.kind, ...stopPayloadSchema.parse(message.payload) };
  }
  if (message.kind === "inbox/clear") {
    return { ...base, kind: message.kind, ...clearPayloadSchema.parse(message.payload) };
  }
  if (message.kind === "inbox/scheduleDue") {
    const payload = scheduleDuePayloadSchema.parse(message.payload);
    return { ...base, kind: message.kind, turn: turnOf(message), ...payload };
  }
  const { intent } = settlePayloadSchema.parse(message.payload);
  const view = await intentView(intent, signal);
  if (view === undefined) {
    throw new BinferenceError({
      code: "engine.intent_missing",
      message: `The intent of inbox message ${message.id} is not stored.`,
      details: { message: message.id, intent },
    });
  }
  return { ...base, kind: "inbox/intentSettled", turn: turnOf(message), intent: view };
}

/** A view as JSON, for a push. */
export function inboxPushData(view: InboxMessageView): JsonValue {
  return jsonValueSchema.parse(inboxMessageViewSchema.encode(view));
}
