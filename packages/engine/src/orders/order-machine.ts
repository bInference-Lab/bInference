import { err, type Id, type JsonValue, ok, type Result } from "@binference/core";
import type { OrderState } from "@binference/protocol";
import { isExitOrder, type OrderMove, type OrderRecord } from "./order-record.js";
import { isOrderEnded } from "./order-states.js";
import { disarmedAfterFill } from "./price-triggers.js";

/** How long before an order expires `notice.orderExpiring` goes: 24 hours (decision 0189). */
export const orderExpiryNoticeMs = 86_400_000;

/** The confirmation an `autoOrder` intent holds: the intent and the card version it confirmed. */
interface OrderConfirmation {
  readonly intentId: Id<"int">;
  readonly cardId: Id<"crd">;
}

/**
 * Something that happened to an auto order (decision 0189), with the facts its guard reads: the
 * tap on its card, the card ending otherwise, a cancel, its expiry, a freeze or an unfreeze of its
 * agent, a fill, its position emptied by another exit order, the expiry notice sent, or what its
 * price trigger keeps between prices changed, such as a trailing stop's highest price.
 */
export type OrderTrigger =
  | {
      readonly type: "card_confirmed";
      /** The confirmation its `autoOrder` intent holds, if any. */
      readonly confirmation?: OrderConfirmation;
      readonly isAgentFrozen: boolean;
    }
  | { readonly type: "card_closed"; readonly outcome: "denied" | "cancelled" | "expired" }
  | { readonly type: "cancel_requested" }
  | { readonly type: "expiry_reached" }
  | { readonly type: "agent_frozen" }
  | { readonly type: "agent_unfrozen" }
  | {
      readonly type: "fill_recorded";
      /** The fill sold everything its position held (spec 6, section 5). */
      readonly emptiesPosition?: boolean;
    }
  | { readonly type: "position_closed" }
  | { readonly type: "expiry_noticed" }
  | { readonly type: "trigger_kept"; readonly triggerState: JsonValue };

/** Why the order state machine refused a trigger. */
export type OrderProblem =
  /** The order filled, was cancelled, expired or ended: nothing moves it again. */
  | "ended"
  /** The trigger does not apply in the order's state. */
  | "wrong_state"
  /** No confirmation of the order's own card. */
  | "not_confirmed"
  /** Its agent is frozen. */
  | "frozen"
  /** The order is past its expiry. */
  | "expired"
  /** The order's expiry has not come. */
  | "not_expired"
  /** The order has used every fill it allows. */
  | "no_fill_left"
  /** Only an exit order ends with its position. */
  | "not_exit"
  /** The expiry notice went already, or its time has not come. */
  | "not_due";

type TriggerType = OrderTrigger["type"];
type TriggerOf<T extends TriggerType> = Extract<OrderTrigger, { readonly type: T }>;

/** The part of a move a guard decides: the state and the fields that change with it. */
type Change = Omit<OrderMove, "id" | "expectedVersion" | "atMs">;

interface GuardInput<T extends TriggerType> {
  readonly order: OrderRecord;
  readonly trigger: TriggerOf<T>;
  readonly nowMs: number;
}

type Guard<T extends TriggerType> = (input: GuardInput<T>) => Result<Change, OrderProblem>;

const open: readonly OrderState[] = ["awaiting_confirmation", "active", "paused"];
const running: readonly OrderState[] = ["active", "paused"];

const isPast = (order: OrderRecord, nowMs: number): boolean => nowMs >= order.expiresAtMs;

function confirmCard({
  order,
  trigger,
  nowMs,
}: GuardInput<"card_confirmed">): Result<Change, OrderProblem> {
  const { confirmation } = trigger;
  if (confirmation === undefined || confirmation.intentId !== order.intentId) {
    return err("not_confirmed");
  }
  if (trigger.isAgentFrozen) {
    return err("frozen");
  }
  return isPast(order, nowMs)
    ? err("expired")
    : ok({ state: "active", cardId: confirmation.cardId });
}

// A fill counts once; the last fill fills the order. An exit order whose fill emptied its position
// ends with it; any other order with a fill left waits, disarmed, for its condition to stop
// holding before it fires again, a trailing stop's peak starting again (decision 0197).
function recordFill({
  order,
  trigger,
  nowMs,
}: GuardInput<"fill_recorded">): Result<Change, OrderProblem> {
  if (isPast(order, nowMs)) {
    return err("expired");
  }
  const { maxFills } = order;
  if (maxFills !== undefined && order.fills >= maxFills) {
    return err("no_fill_left");
  }
  const fills = order.fills + 1;
  if (fills === maxFills) {
    return ok({ state: "filled", fills });
  }
  return trigger.emptiesPosition === true && isExitOrder(order.request)
    ? ok({ state: "ended", fills, endReason: "position_closed" })
    : ok({ state: "active", fills, triggerState: disarmedAfterFill });
}

function resume({ order, nowMs }: GuardInput<"agent_unfrozen">): Result<Change, OrderProblem> {
  if (order.cardId === undefined) {
    return err("not_confirmed");
  }
  return ok({ state: isPast(order, nowMs) ? "expired" : "active" });
}

function noticeExpiry({
  order,
  nowMs,
}: GuardInput<"expiry_noticed">): Result<Change, OrderProblem> {
  const isDue =
    order.expiryNoticedAtMs === undefined && nowMs >= order.expiresAtMs - orderExpiryNoticeMs;
  return isDue ? ok({ state: order.state, expiryNoticedAtMs: nowMs }) : err("not_due");
}

/** One trigger's rule: the states it applies in, and its guard. */
interface OrderRule<T extends TriggerType> {
  readonly from: readonly OrderState[];
  readonly guard: Guard<T>;
}

type OrderRules = { readonly [T in TriggerType]: OrderRule<T> };

/**
 * The order state machine's table (decision 0189). An order becomes `active` only on its card's
 * confirmation, or back from `paused` once it had one; a freeze pauses an active order and cancels
 * one waiting for its card; an expired order never fills.
 */
const orderRules: OrderRules = {
  card_confirmed: { from: ["awaiting_confirmation"], guard: confirmCard },
  card_closed: {
    from: ["awaiting_confirmation"],
    guard: ({ trigger }) => ok({ state: trigger.outcome === "expired" ? "expired" : "cancelled" }),
  },
  cancel_requested: { from: open, guard: () => ok({ state: "cancelled" }) },
  expiry_reached: {
    from: open,
    guard: ({ order, nowMs }) =>
      isPast(order, nowMs) ? ok({ state: "expired" }) : err("not_expired"),
  },
  agent_frozen: {
    from: ["awaiting_confirmation", "active"],
    guard: ({ order }) => ok({ state: order.state === "active" ? "paused" : "cancelled" }),
  },
  agent_unfrozen: { from: ["paused"], guard: resume },
  fill_recorded: { from: ["active"], guard: recordFill },
  position_closed: {
    from: running,
    guard: ({ order }) =>
      isExitOrder(order.request)
        ? ok({ state: "ended", endReason: "position_closed" })
        : err("not_exit"),
  },
  expiry_noticed: { from: running, guard: noticeExpiry },
  trigger_kept: {
    from: ["active"],
    guard: ({ order, trigger }) => ok({ state: order.state, triggerState: trigger.triggerState }),
  },
};

function applyTrigger<T extends TriggerType>(
  input: GuardInput<T>,
): Result<OrderMove, OrderProblem> {
  const { order, trigger, nowMs } = input;
  if (isOrderEnded(order.state)) {
    return err("ended");
  }
  const rule = orderRules[trigger.type];
  if (!rule.from.includes(order.state)) {
    return err("wrong_state");
  }
  const change = rule.guard(input);
  return change.ok
    ? ok({ id: order.id, expectedVersion: order.version, atMs: nowMs, ...change.value })
    : change;
}

/**
 * Decides one move of an order on a trigger at `nowMs`, or why it does not move. It never writes:
 * the caller stores the move under the version it read, so a stale write fails.
 */
export function moveOrder(
  order: OrderRecord,
  trigger: OrderTrigger,
  nowMs: number,
): Result<OrderMove, OrderProblem> {
  return applyTrigger({ order, trigger, nowMs });
}
