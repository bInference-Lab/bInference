import { err, type Id, type JsonValue, ok, type Result } from "@binference/core";
import type { OrderState } from "@binference/protocol";
import {
  copyStartOf,
  copyStateAfterFill,
  copyStateDocument,
  copyStateOf,
  type CopyTraded,
} from "./copy-state.js";
import { hasPriceTrigger, isExitOrder, type OrderMove, type OrderRecord } from "./order-record.js";
import { endedOrderStates, isOrderEnded } from "./order-states.js";
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
 * agent, a paper fill, a live fill that landed, its position emptied by another exit order, the
 * expiry notice sent, or what its price trigger keeps between prices changed, such as a trailing
 * stop's highest price.
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
      /** What a copy order's fill traded, which its state counts (decision 0260). */
      readonly traded?: CopyTraded;
    }
  | {
      readonly type: "fill_landed";
      /** The fill sold everything its position held (spec 6, section 5). */
      readonly emptiesPosition?: boolean;
      /** What a copy order's fill traded, which its state counts (decision 0260). */
      readonly traded?: CopyTraded;
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
  | "not_due"
  /** A copy order's fill that names no trade, or an order whose copy state does not read. */
  | "no_trade";

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
  if (isPast(order, nowMs)) {
    return err("expired");
  }
  // A copy order copies the leader's trades from the moment it becomes active (decision 0260).
  const copy =
    order.kind === "copy" ? { triggerState: copyStateDocument.encode(copyStartOf(nowMs)) } : {};
  return ok({ state: "active", cardId: confirmation.cardId, ...copy });
}

// What an order with a fill left keeps after a fill: a price order waits, disarmed, for its
// condition to stop holding, a trailing stop's peak starting again (decision 0197); a DCA order
// keeps its next period (decision 0246); a copy order counts what its fill traded (decision 0260),
// and one whose fill names no trade records nothing.
function afterFill(
  order: OrderRecord,
  traded: CopyTraded | undefined,
): Result<Pick<Change, "triggerState">, OrderProblem> {
  if (order.kind !== "copy") {
    return ok(hasPriceTrigger(order.kind) ? { triggerState: disarmedAfterFill } : {});
  }
  const state = copyStateOf(order.triggerState);
  if (state === undefined || traded === undefined) {
    return err("no_trade");
  }
  return ok({ triggerState: copyStateDocument.encode(copyStateAfterFill(state, traded)) });
}

// A fill counts once; the last fill fills the order. An exit order whose fill emptied its position
// ends with it; any other order with a fill left goes on as `afterFill` says.
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
  if (trigger.emptiesPosition === true && isExitOrder(order.request)) {
    return ok({ state: "ended", fills, endReason: "position_closed" });
  }
  const kept = afterFill(order, trigger.traded);
  return kept.ok ? ok({ state: "active", fills, ...kept.value }) : kept;
}

// A live fill that landed counts whatever its order became while it was under way (decision
// 0210): its transaction moved the funds. An order that ended since keeps its state and counts it;
// otherwise the fill counts as a recorded one does, at any time, and a paused order stays paused.
function landFill({ order, trigger }: GuardInput<"fill_landed">): Result<Change, OrderProblem> {
  const fills = order.fills + 1;
  const { maxFills } = order;
  if (isOrderEnded(order.state)) {
    return ok({ state: order.state, fills });
  }
  if (maxFills !== undefined && fills >= maxFills) {
    return ok({ state: "filled", fills });
  }
  if (trigger.emptiesPosition === true && isExitOrder(order.request)) {
    return ok({ state: "ended", fills, endReason: "position_closed" });
  }
  // The funds moved: a copy order whose state cannot count them still counts the fill.
  const kept = afterFill(order, trigger.traded);
  return ok({ state: order.state, fills, ...(kept.ok ? kept.value : {}) });
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
  fill_landed: { from: [...running, ...endedOrderStates], guard: landFill },
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
  // Only a landed live fill still counts on an order that ended (decision 0210).
  if (isOrderEnded(order.state) && trigger.type !== "fill_landed") {
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

/**
 * Whether a move of an order that ended only counts a live fill that landed after it ended
 * (decision 0210): it keeps the order's state and raises its fills by one, and changes nothing
 * else. The order stores move an ended order only so.
 */
export function countsLandedFill(
  order: Pick<OrderRecord, "state" | "fills">,
  move: OrderMove,
): boolean {
  const { cardId, endReason, triggerState, expiryNoticedAtMs } = move;
  const changesOnlyFills =
    cardId === undefined &&
    endReason === undefined &&
    triggerState === undefined &&
    expiryNoticedAtMs === undefined;
  return (
    isOrderEnded(order.state) &&
    move.state === order.state &&
    move.fills === order.fills + 1 &&
    changesOnlyFills
  );
}
