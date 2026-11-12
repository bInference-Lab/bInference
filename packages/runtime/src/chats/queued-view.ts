import {
  type Id,
  idSchema,
  type JsonValue,
  jsonValueSchema,
  replaceNulDeep,
} from "@binference/core";
import {
  alertConditionSchema,
  alertFireSchema,
  type ChatSurface,
  type InboxMessageView,
  inboxMessageViewSchema,
} from "@binference/protocol";
import type { InboxKind, QueuedMessage } from "@binference/store";
import type { OwnerMessage } from "../loop/model-message.js";
import type { TurnPhoto } from "../sessions/turn-place.js";

/** A message that can start a turn, or join one. */
export type TurnMessage = Extract<InboxMessageView, { readonly turn: Id<"trn"> }>;

const turnKinds: ReadonlySet<InboxKind> = new Set<InboxKind>([
  "inbox/message",
  "inbox/intentSettled",
  "inbox/scheduleDue",
  "inbox/alertFired",
]);

// The kinds that only wake the agent: a turn skips them once the budget of the day is spent
// (runtime spec, section 8.3).
const wakeUpKinds: ReadonlySet<InboxKind> = new Set<InboxKind>([
  "inbox/scheduleDue",
  "inbox/alertFired",
]);

/** Whether a message of this kind can start a turn or join one (runtime spec, section 3.3). */
export function startsTurns(kind: InboxKind): boolean {
  return turnKinds.has(kind);
}

/**
 * Whether a message only wakes the agent, as a schedule's or an alert's does, so a spent budget
 * skips it.
 */
export function isWakeUp(kind: InboxKind): boolean {
  return wakeUpKinds.has(kind);
}

/** A message's view as the chat queue keeps it: the JSON the engine sent. */
export function payloadOf(view: InboxMessageView): JsonValue {
  return jsonValueSchema.parse(inboxMessageViewSchema.encode(view));
}

/**
 * A message's view with U+FFFD in place of each U+0000 (decision 0416): the engine may still hold
 * one it stored before that decision, which the chat queue would refuse.
 */
export function viewWithoutNul(view: InboxMessageView): InboxMessageView {
  return inboxMessageViewSchema.parse(replaceNulDeep(payloadOf(view)));
}

/**
 * The view a queued message holds, when it holds one this runtime reads, with U+FFFD in place of
 * each U+0000: a message queued before decision 0416 may hold it, and a turn writes its words
 * again.
 */
export function queuedViewOf(message: QueuedMessage): InboxMessageView | undefined {
  const parsed = inboxMessageViewSchema.safeParse(replaceNulDeep(message.payload));
  return parsed.success ? parsed.data : undefined;
}

/** The view a queued message holds, when it holds one this runtime reads and it can start a turn. */
export function turnMessageOf(message: QueuedMessage): TurnMessage | undefined {
  const view = queuedViewOf(message);
  return view !== undefined && "turn" in view ? view : undefined;
}

/**
 * Whether a queued message is binference's words for a chat's next goal turn (decision 0407): it
 * starts a turn only alone, and never joins a running one.
 */
export function isGoalTurn(message: QueuedMessage): boolean {
  const view = turnMessageOf(message);
  return view?.kind === "inbox/message" && view.goalTurn === true;
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

// An alert's wake-up reaches the model as the alert's condition and what fired it, as the
// protocol's JSON writes them, with the time it fired (protocol spec, section 8.4).
function alertText(view: Extract<TurnMessage, { readonly kind: "inbox/alertFired" }>): string {
  const { alert, condition, firedAt } = view.alert;
  const at = new Date(firedAt ?? view.at).toISOString();
  const watched = JSON.stringify(alertConditionSchema.encode(condition));
  const fired = JSON.stringify(alertFireSchema.encode(view.fired));
  return `Alert ${alert} on ${watched} fired at ${at}: ${fired}`;
}

type ResumeReport = Extract<InboxMessageView, { readonly kind: "inbox/resumeReport" }>;

// A resume report reaches the model as one line: the downtime, the counts, then each order's
// outcome and the reason of a skip (decision 0267).
function resumeText(view: ResumeReport): string {
  const since = new Date(view.offFrom).toISOString();
  const minutes = String(Math.round(view.offMs / 60_000));
  const span = {
    start: `The engine was off for ${minutes} min from ${since}`,
    wake: `The engine paused for ${minutes} min from ${since}, as when the machine sleeps`,
    clock: `The wall clock was set back by ${minutes} min at ${since}`,
  }[view.cause];
  const orders = view.orders
    .map(({ order, kind, outcome, reason }) =>
      reason === undefined
        ? `${order} (${kind}) ${outcome}`
        : `${order} (${kind}) ${outcome}: ${reason}`,
    )
    .join("; ");
  const counts = `${String(view.checked)} of your orders checked, ${String(view.filled)} filled, ${String(view.skipped)} skipped`;
  const head = `${span}, then re-checked your auto orders: ${counts}.`;
  return orders.length === 0 ? head : `${head} ${orders}.`;
}

/**
 * The note a queued message adds to the agent's next turn without starting one: a resume report,
 * as one line the model reads (runtime spec, section 3.3); `undefined` for any other message.
 */
export function noteOf(message: QueuedMessage): OwnerMessage | undefined {
  const view = queuedViewOf(message);
  if (view?.kind !== "inbox/resumeReport") {
    return undefined;
  }
  return { id: view.message, text: resumeText(view), outside: false };
}

/**
 * A message as a turn's conversation holds it: one with images or marked by the engine is outside
 * content, and so is a schedule's wake-up whose `outsideContent` is set, and every alert's
 * wake-up.
 */
export function ownerMessageOf(view: TurnMessage): OwnerMessage {
  if (view.kind === "inbox/intentSettled") {
    return { id: view.message, text: settleText(view), outside: false };
  }
  if (view.kind === "inbox/scheduleDue") {
    return { id: view.message, text: scheduleText(view), outside: view.outsideContent };
  }
  // What fires an alert is a market's or another wallet's doing: every alert wake-up is outside
  // content, whatever the message says (decision 0245).
  if (view.kind === "inbox/alertFired") {
    return { id: view.message, text: alertText(view), outside: true };
  }
  // A helper's report the engine wrote in the owner's place is outside content when the helper read
  // some (decision 0403).
  const { images } = view;
  return {
    id: view.message,
    text: view.text,
    outside: images !== undefined || view.outsideContent === true,
    ...(images === undefined ? {} : { images }),
  };
}

/** The photos the owner sent the bot with a turn's messages, in order (decision 0286). */
export function photosOf(owners: readonly OwnerMessage[]): readonly TurnPhoto[] {
  return owners.flatMap((owner) => {
    const message = idSchema("msg").safeParse(owner.id);
    const images = (owner.images ?? []).filter((image) => image.startsWith("tg:"));
    return message.success ? images.map((image) => ({ message: message.data, image })) : [];
  });
}

/** The surface of the first owner's message a turn took; none for a turn the engine started. */
export function surfaceOf(queued: readonly QueuedMessage[]): ChatSurface | undefined {
  const views = queued.map((each) => turnMessageOf(each));
  const owned = views.find((view) => view?.kind === "inbox/message");
  return owned?.kind === "inbox/message" ? owned.surface : undefined;
}
