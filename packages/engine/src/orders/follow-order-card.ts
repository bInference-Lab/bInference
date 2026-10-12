import type { Id } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentState } from "../intents/intent-state.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import type { OrderParts } from "./create-order.js";
import { moveOrder, type OrderTrigger } from "./order-machine.js";
import type { OrderRecord } from "./order-record.js";
import { orderPush } from "./order-view-of.js";

// The confirmation the intent holds, with the id of the card version it confirmed.
function confirmationOf(
  snapshot: IntentSnapshot,
): OrderTrigger & { readonly type: "card_confirmed" } {
  const version = snapshot.stored.confirmation?.cardVersion;
  const card = snapshot.history.cards.find((stored) => stored.version === version);
  return {
    type: "card_confirmed",
    ...(card === undefined
      ? {}
      : { confirmation: { intentId: snapshot.record.id, cardId: card.id } }),
    isAgentFrozen: snapshot.settings.agent.frozenAtMs !== undefined,
  };
}

// The states of a card that is still on its way to the owner, or waits for the answer.
const waitingStates: ReadonlySet<IntentState> = new Set<IntentState>([
  "proposed",
  "checked",
  "quoted",
  "assessed",
  "simulated",
  "awaiting_confirmation",
]);

// What the card's state means for its order: a confirmation, an end, or nothing yet. An intent
// that is not stored, because a stop came between the order and its intent, ends the order.
function triggerOf(snapshot: IntentSnapshot | undefined): OrderTrigger | undefined {
  const state = snapshot?.record.state;
  if (snapshot === undefined || state === undefined) {
    return { type: "card_closed", outcome: "cancelled" };
  }
  if (state === "confirmed" || state === "reconciled") {
    return confirmationOf(snapshot);
  }
  if (waitingStates.has(state)) {
    return undefined;
  }
  return state === "denied" || state === "expired"
    ? { type: "card_closed", outcome: state }
    : { type: "card_closed", outcome: "cancelled" };
}

// Moves a waiting order as its card says; a move another write beat leaves the order to it.
async function moveWaiting(
  parts: OrderParts,
  read: {
    readonly order: OrderRecord;
    readonly snapshot: IntentSnapshot | undefined;
    readonly nowMs: number;
  },
  signal: AbortSignal,
): Promise<void> {
  const { order, snapshot, nowMs } = read;
  const trigger = triggerOf(snapshot);
  if (order.state !== "awaiting_confirmation" || trigger === undefined) {
    return;
  }
  const decided = moveOrder(order, trigger, nowMs);
  // A tap that came after the order's own expiry ends it as expired.
  const move =
    !decided.ok && decided.error === "expired"
      ? moveOrder(order, { type: "expiry_reached" }, nowMs)
      : decided;
  const written = move.ok ? await parts.orders.move([move.value], { signal }) : undefined;
  if (written?.ok === true) {
    written.value.forEach((moved) => {
      parts.publish(orderPush(moved, "order/changed"));
    });
  }
}

// The card as it stands, after its timer closed it once its time was up.
async function readCard(
  parts: OrderParts,
  intent: Id<"int">,
  read: { readonly nowMs: number; readonly signal: AbortSignal },
): Promise<IntentSnapshot | undefined> {
  const { nowMs, signal } = read;
  const snapshot = await parts.stored.snapshot(intent, { signal });
  const card = snapshot?.history.cards.at(-1);
  const isDue =
    snapshot?.record.state === "awaiting_confirmation" &&
    card !== undefined &&
    nowMs >= card.expiresAtMs;
  if (!isDue) {
    return snapshot;
  }
  await parts.expireCard(intent, { signal });
  return parts.stored.snapshot(intent, { signal });
}

// A confirmed card whose order is written, active or ended, has nothing more to run.
async function closeIntent(
  parts: OrderParts,
  snapshot: IntentSnapshot | undefined,
  signal: AbortSignal,
): Promise<IntentSnapshot | undefined> {
  if (snapshot?.record.state !== "confirmed") {
    return snapshot;
  }
  const machine = createIntentStateMachine({ clock: parts.clock });
  const step = machine.apply(snapshot.stored.status, { type: "order_written" });
  if (!step.ok) {
    return snapshot;
  }
  const move = { intent: snapshot.record.id, version: snapshot.stored.version, step: step.value };
  const moved = await parts.stored.move({ ...move, by: "engine" }, { signal });
  return moved.ok ? moved.value : parts.stored.snapshot(snapshot.record.id, { signal });
}

/**
 * Follows an order's card (decision 0189): on its Confirm the order becomes `active`, unless it
 * expired meanwhile or its agent is frozen; on Cancel, a cancel of the intent or a freeze it
 * becomes `cancelled`, on the card's timer `expired`. The confirmed intent then moves to
 * `reconciled`. An answer runs it at once; the order timer runs it for every waiting order, which
 * also finishes a tap a stop cut short. It answers the intent as it stands after.
 */
export async function followOrderCard(
  parts: OrderParts,
  intent: Id<"int">,
  signal: AbortSignal,
): Promise<IntentSnapshot | undefined> {
  // The time is read before the card: a tap the read misses came after it, so after any expiry
  // it sees.
  const nowMs = parts.clock.now();
  const [order, snapshot] = await Promise.all([
    parts.orders.byIntent(intent, { signal }),
    readCard(parts, intent, { nowMs, signal }),
  ]);
  if (order !== undefined) {
    await moveWaiting(parts, { order, snapshot, nowMs }, signal);
  }
  return closeIntent(parts, snapshot, signal);
}

/** Follows the card of each order waiting for it, oldest first (`followOrderCard`). */
export async function followWaitingOrders(parts: OrderParts, signal: AbortSignal): Promise<void> {
  const waiting = await parts.orders.list(
    { states: ["awaiting_confirmation"], limit: 1_000 },
    { signal },
  );
  // One at a time, oldest first: each reads its card, then writes its order.
  await waiting.reduce<Promise<void>>(async (done, order) => {
    await done;
    await followOrderCard(parts, order.intentId, signal);
  }, Promise.resolve());
}
