import { type Bps, idSchema } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testAgent, testToken, testWallet } from "../intents/test-intents.js";
import { countsLandedFill, moveOrder, type OrderTrigger } from "./order-machine.js";
import { hasPriceTrigger, type OrderMove, type OrderRecord } from "./order-record.js";
import { isOrderEnded } from "./order-states.js";

const intentId = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const otherIntent = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const cardId = idSchema("crd").parse("crd_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const startMs = 1_000_000;

/** One thing that happens to the order, its agent or the clock. */
type Step =
  | { readonly type: "tap"; readonly confirmation: "own" | "other" | "none" }
  | { readonly type: "closed"; readonly outcome: "denied" | "cancelled" | "expired" }
  | { readonly type: "cancel" }
  | { readonly type: "expire" }
  | { readonly type: "freeze" }
  /**
   * The agent froze, and the freeze's write held no move of this order, waiting for its card: it
   * was stored after the freeze read the orders. A freeze always moves an active order, under the
   * version it read.
   */
  | { readonly type: "freezeMissed" }
  | { readonly type: "unfreeze" }
  | { readonly type: "fill" }
  /** A live fill signed under its grant: its order was active with a fill left, none pending. */
  | { readonly type: "sign" }
  /** The signed live fill landed and settles. */
  | { readonly type: "land" }
  | { readonly type: "positionClosed" }
  | { readonly type: "notice" }
  | { readonly type: "keep" }
  | { readonly type: "wait"; readonly ms: number };

const steps: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    type: fc.constant("tap" as const),
    confirmation: fc.constantFrom("own" as const, "other" as const, "none" as const),
  }),
  fc.record({
    type: fc.constant("closed" as const),
    outcome: fc.constantFrom("denied" as const, "cancelled" as const, "expired" as const),
  }),
  fc.constantFrom<Step>(
    { type: "cancel" },
    { type: "expire" },
    { type: "freeze" },
    { type: "freezeMissed" },
    { type: "unfreeze" },
    { type: "fill" },
    { type: "sign" },
    { type: "land" },
    { type: "positionClosed" },
    { type: "notice" },
    { type: "keep" },
  ),
  fc.record({ type: fc.constant("wait" as const), ms: fc.integer({ min: 1, max: 40_000_000 }) }),
);

const terms = {
  agent: fc.constant(testAgent),
  token: fc.constant(testToken),
  size: fc.constant({ usdMicros: 1n }),
};

const requests: fc.Arbitrary<OrderRequest> = fc.oneof(
  fc.record({
    ...terms,
    kind: fc.constant("limit" as const),
    side: fc.constantFrom("buy" as const, "sell" as const),
    trigger: fc.constant({ price: 1n, direction: "above" as const }),
  }),
  fc.record({
    ...terms,
    kind: fc.constantFrom("takeProfit" as const, "stopLoss" as const),
    side: fc.constant("sell" as const),
    trigger: fc.constant({ price: 1n }),
  }),
  fc.record({
    ...terms,
    kind: fc.constant("trailing" as const),
    side: fc.constant("sell" as const),
    trigger: fc.constant({ distanceBps: 500 as Bps }),
  }),
  fc.record({
    ...terms,
    kind: fc.constant("dca" as const),
    side: fc.constant("buy" as const),
    trigger: fc.constant({ cron: "*/5 * * * *", timezone: "UTC" }),
  }),
);

function orderOf(drawn: {
  readonly request: OrderRequest;
  readonly lifetimeMs: number;
  readonly maxFills: number;
}): OrderRecord {
  const { request, lifetimeMs, maxFills } = drawn;
  const order: OrderRecord = {
    id: idSchema("ord").parse("ord_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    agentId: testAgent,
    walletId: testWallet,
    kind: request.kind,
    state: "awaiting_confirmation",
    request,
    fills: 0,
    expiresAtMs: startMs + lifetimeMs,
    intentId,
    isPaper: true,
    hasOutsideContent: false,
    createdAtMs: startMs,
    changedAtMs: startMs,
    version: 0,
  };
  // A limit of 0 draws an order with no fill limit.
  return maxFills === 0 ? order : { ...order, maxFills };
}

const orders: fc.Arbitrary<OrderRecord> = fc
  .record({
    request: requests,
    lifetimeMs: fc.integer({ min: 1, max: 100_000_000 }),
    maxFills: fc.integer({ min: 0, max: 3 }),
  })
  .map(orderOf);

/** The world around the order: the time, whether its agent is frozen, what its card said. */
interface World {
  readonly order: OrderRecord;
  readonly nowMs: number;
  readonly isFrozen: boolean;
  /** A tap on the order's own card was taken. */
  readonly wasConfirmed: boolean;
  /** The fills the order had when a live fill now under way was signed; none while none is. */
  readonly signedAt?: number;
  readonly violations: readonly string[];
}

const confirmations = {
  own: { confirmation: { intentId, cardId } },
  other: { confirmation: { intentId: otherIntent, cardId } },
  none: {},
};

type Triggers = {
  readonly [T in Step["type"]]: (
    step: Extract<Step, { readonly type: T }>,
    world: World,
  ) => OrderTrigger | undefined;
};

const triggers: Triggers = {
  tap: (step, world) => ({
    type: "card_confirmed",
    ...confirmations[step.confirmation],
    isAgentFrozen: world.isFrozen,
  }),
  closed: (step) => ({ type: "card_closed", outcome: step.outcome }),
  cancel: () => ({ type: "cancel_requested" }),
  expire: () => ({ type: "expiry_reached" }),
  freeze: () => ({ type: "agent_frozen" }),
  freezeMissed: (_step, world) =>
    world.order.state === "awaiting_confirmation" ? undefined : { type: "agent_frozen" },
  unfreeze: () => ({ type: "agent_unfrozen" }),
  // An agent's fills wait while its live fill is under way (decision 0210).
  fill: (_step, world) => (world.signedAt === undefined ? { type: "fill_recorded" } : undefined),
  sign: () => undefined,
  land: (_step, world) => (world.signedAt === undefined ? undefined : { type: "fill_landed" }),
  positionClosed: () => ({ type: "position_closed" }),
  notice: () => ({ type: "expiry_noticed" }),
  keep: () => ({ type: "trigger_kept", triggerState: { peak: "2" } }),
  wait: () => undefined,
};

function triggerOf<T extends Step["type"]>(
  step: Extract<Step, { readonly type: T }>,
  world: World,
): OrderTrigger | undefined {
  const build: Triggers[T] = triggers[step.type];
  return build(step, world);
}

// Applies a move as the store writes it.
function applied(order: OrderRecord, move: OrderMove): OrderRecord {
  const { id: _id, expectedVersion: _version, atMs, ...fields } = move;
  return { ...order, ...fields, changedAtMs: atMs, version: order.version + 1 };
}

/** One move the machine allowed, with the order and the world before it. */
interface Moved {
  readonly before: World;
  readonly trigger: OrderTrigger;
  readonly move: OrderMove;
  readonly isOwnTap: boolean;
  readonly after: OrderRecord;
}

// Each invariant of decision 0189 for one move, named when it breaks.
const moveChecks: readonly ((moved: Moved) => string)[] = [
  ({ before, trigger, after }) =>
    trigger.type === "trigger_kept" && (before.order.state !== "active" || after.state !== "active")
      ? "a trigger's state moved an order that was not active, or changed its state"
      : "",
  ({ before, trigger, move }) =>
    isOrderEnded(before.order.state) &&
    !(trigger.type === "fill_landed" && countsLandedFill(before.order, move))
      ? `a ${trigger.type} moved an order that had ended`
      : "",
  ({ before, trigger, after }) =>
    trigger.type === "fill_landed" && after.fills !== before.order.fills + 1
      ? "a landed fill did not count once"
      : "",
  ({ before, isOwnTap, after }) =>
    after.state === "active" && before.order.state !== "active" && !before.wasConfirmed && !isOwnTap
      ? "an order became active without its card's confirmation"
      : "",
  ({ before, trigger }) =>
    trigger.type === "fill_recorded" && before.nowMs >= before.order.expiresAtMs
      ? "an expired order filled"
      : "",
  ({ after }) =>
    after.maxFills !== undefined && after.fills > after.maxFills
      ? "an order filled past its limit"
      : "",
  ({ before, trigger, after }) =>
    after.state === "expired" &&
    before.nowMs < before.order.expiresAtMs &&
    trigger.type !== "card_closed"
      ? "an order expired before its time"
      : "",
];

// The invariants that hold between moves: a frozen agent has no active order, an active order
// holds the card that confirmed it, and an ended order says why.
const stateChecks: readonly ((world: World) => string)[] = [
  ({ order, isFrozen }) =>
    isFrozen && order.state === "active" ? "a frozen agent has an active order" : "",
  ({ order }) =>
    order.state === "active" && order.cardId !== cardId ? "an active order lacks its card" : "",
  ({ order }) =>
    order.state === "ended" && order.endReason !== "position_closed"
      ? "an order ended for no reason"
      : "",
];

const named = (texts: readonly string[]): readonly string[] => texts.filter((text) => text !== "");

// The agent's freeze changes with the step, whatever the order does.
function frozenAfter(step: Step, world: World): boolean {
  if (step.type === "freeze" || step.type === "freezeMissed") {
    return true;
  }
  return step.type === "unfreeze" ? false : world.isFrozen;
}

// What the step did to the order: its move, when the machine allowed one.
function movedBy(step: Step, world: World): Moved | undefined {
  const trigger = triggerOf(step, world);
  const moved = trigger === undefined ? undefined : moveOrder(world.order, trigger, world.nowMs);
  if (trigger === undefined || moved?.ok !== true) {
    return undefined;
  }
  const isOwnTap = step.type === "tap" && step.confirmation === "own";
  const move = moved.value;
  return { before: world, trigger, move, isOwnTap, after: applied(world.order, move) };
}

// The fills the order had when its live fill under way was signed: the signer signs one only for
// an active order before its expiry with a fill left (decision 0210), and it clears as it lands.
function signedAfter(step: Step, world: World): number | undefined {
  const { order, nowMs, signedAt } = world;
  if (step.type === "land") {
    return undefined;
  }
  const hasFillLeft = order.maxFills === undefined || order.fills < order.maxFills;
  const canSign = order.state === "active" && nowMs < order.expiresAtMs && hasFillLeft;
  return step.type === "sign" && signedAt === undefined && canSign ? order.fills : signedAt;
}

function stepped(world: World, step: Step): World {
  const nowMs = step.type === "wait" ? world.nowMs + step.ms : world.nowMs;
  const moved = movedBy(step, { ...world, nowMs });
  const signedAt = signedAfter(step, { ...world, nowMs });
  const next: World = {
    order: moved?.after ?? world.order,
    nowMs,
    isFrozen: frozenAfter(step, world),
    wasConfirmed: world.wasConfirmed || moved?.isOwnTap === true,
    ...(signedAt === undefined ? {} : { signedAt }),
    violations: [
      ...world.violations,
      ...(moved === undefined ? [] : named(moveChecks.map((check) => check(moved)))),
    ],
  };
  const broken = named(stateChecks.map((check) => check(next)));
  return { ...next, violations: [...next.violations, ...broken] };
}

// What a fill leaves in an active order's trigger state that kept a DCA period, and what it must:
// the period untouched, unless the order is a price order that goes on, which its fill disarms.
function afterFillOf(order: OrderRecord, type: "fill_recorded" | "fill_landed") {
  const active: OrderRecord = {
    ...order,
    state: "active",
    cardId,
    triggerState: { nextAtMs: startMs + 300_000 },
  };
  const moved = moveOrder(active, { type }, startMs);
  const goesOn = moved.ok && moved.value.state === "active";
  return {
    kept: moved.ok ? moved.value.triggerState : undefined,
    expected: goesOn && hasPriceTrigger(order.kind) ? { disarmed: true } : undefined,
  };
}

const start = (order: OrderRecord): World => ({
  order,
  nowMs: startMs,
  isFrozen: false,
  wasConfirmed: false,
  violations: [],
});

describe("the order state machine, for every history of taps, freezes, expiries, cancels and fills", () => {
  it("never makes an order active without its card's confirmation, nor for a frozen agent", () => {
    fc.assert(
      fc.property(orders, fc.array(steps, { maxLength: 30 }), (order, history: readonly Step[]) => {
        expect(history.reduce(stepped, start(order)).violations).toStrictEqual([]);
      }),
      { numRuns: 2_000 },
    );
  });

  it("never fills an order at or past its expiry, even before anything moved it to expired", () => {
    fc.assert(
      fc.property(orders, fc.integer({ min: 0, max: 10_000 }), (order, lateMs) => {
        const active: OrderRecord = { ...order, state: "active", cardId };
        const filled = moveOrder(active, { type: "fill_recorded" }, active.expiresAtMs + lateMs);
        expect(filled).toStrictEqual({ ok: false, error: "expired" });
      }),
    );
  });

  it("keeps a DCA order's period through its fills, and disarms a price order with fills left", () => {
    const fills = fc.constantFrom("fill_recorded" as const, "fill_landed" as const);
    fc.assert(
      fc.property(orders, fills, (order, type) => {
        const { kept, expected } = afterFillOf(order, type);
        expect(kept).toStrictEqual(expected);
      }),
    );
  });
});
