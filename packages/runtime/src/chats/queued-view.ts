import { type Id, type JsonValue, jsonValueSchema } from "@binference/core";
import { type InboxMessageView, inboxMessageViewSchema } from "@binference/protocol";
import type { InboxKind, QueuedMessage } from "@binference/store";
import type { OwnerMessage } from "../loop/model-message.js";

/** A message that can start a turn, or join one. */
export type TurnMessage = Extract<InboxMessageView, { readonly turn: Id<"trn"> }>;

const turnKinds: ReadonlySet<InboxKind> = new Set<InboxKind>([
  "inbox/message",
  "inbox/intentSettled",
  "inbox/scheduleDue",
]);

// The kinds that only wake the agent: a turn skips them once the budget of the day is spent
// (runtime spec, section 8.3).
const wakeUpKinds: ReadonlySet<InboxKind> = new Set<InboxKind>(["inbox/scheduleDue"]);

/** Whether a message of this kind can start a turn or join one (runtime spec, section 3.3). */
export function startsTurns(kind: InboxKind): boolean {
  return turnKinds.has(kind);
}

/** Whether a message only wakes the agent, as a schedule's does, so a spent budget skips it. */
export function isWakeUp(kind: InboxKind): boolean {
  return wakeUpKinds.has(kind);
}

/** A message's view as the chat queue keeps it: the JSON the engine sent. */
export function payloadOf(view: InboxMessageView): JsonValue {
  return jsonValueSchema.parse(inboxMessageViewSchema.encode(view));
}

/** The view a queued message holds, when it holds one this runtime reads and it can start a turn. */
export function turnMessageOf(message: QueuedMessage): TurnMessage | undefined {
  const parsed = inboxMessageViewSchema.safeParse(message.payload);
  if (!parsed.success) {
    return undefined;
  }
  const view = parsed.data;
  return "turn" in view ? view : undefined;
}

// A settle message reaches the model as one line that names the intent, its kind and its state
// (decision 0174).
function settleText(view: Extract<TurnMessage, { readonly kind: "inbox/intentSettled" }>): string {
  const { intent, kind, state, paper } = view.intent;
  return `The ${paper ? "paper " : ""}${kind} intent ${intent} you proposed is now ${state}.`;
}

// A schedule's wake-up reaches the model as its prompt, with the time it was due, so a run missed
// while the engine was off reads as late (decision 0232).
function scheduleText(view: Extract<TurnMessage, { readonly kind: "inbox/scheduleDue" }>): string {
  const due = new Date(view.due).toISOString();
  return `Schedule ${view.schedule}, due at ${due}, runs now: ${view.prompt}`;
}

/**
 * A message as a turn's conversation holds it: one with images is outside content, and so is a
 * schedule's wake-up when the schedule was set in a turn that held outside content.
 */
export function ownerMessageOf(view: TurnMessage): OwnerMessage {
  if (view.kind === "inbox/intentSettled") {
    return { id: view.message, text: settleText(view), outside: false };
  }
  if (view.kind === "inbox/scheduleDue") {
    return { id: view.message, text: scheduleText(view), outside: view.outsideContent };
  }
  const { images } = view;
  return {
    id: view.message,
    text: view.text,
    outside: images !== undefined,
    ...(images === undefined ? {} : { images }),
  };
}
