import type { Bps } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AutoModeFacts } from "./auto-mode.js";
import type { CardRules } from "./card-rules.js";
import { type IntentKind, intentKinds } from "./intent-kind.js";
import type { IntentStatus } from "./intent-status.js";
import type { IntentTrigger, TriggerType } from "./intent-trigger.js";
import { createIntentStateMachine } from "./state-machine.js";

// Decision 0234: a token launch waits in `quoted` until its launchpad reports the pin, and only
// that report moves it on, so no launch reaches its card, a signature or `executing` before it.
const cards: CardRules = {
  tradeExpiryMs: 60_000,
  otherExpiryMs: 600_000,
  requoteAfterMs: 10_000,
  requoteToleranceBps: 50 as Bps,
};

// The auto test's facts for an agent in auto mode, inside every cap: only the kind can refuse.
const auto: AutoModeFacts = {
  approvalMode: "auto",
  modeVersion: 1,
  isLocked: false,
  isInsideOwnPositions: true,
  sellsDeniedToken: false,
  valueUsdMicros: 1n,
  perTradeCapUsdMicros: 100n,
  rollingDayCapUsdMicros: 100n,
  rollingDaySpentUsdMicros: 0n,
  feePerGasNativeBase: 0n,
  networkFeeCapNativeBase: 1n,
  hasUnlistedSpender: false,
};

// Every trigger a launch's path meets on its way to `executing`, with its pin's report and
// failure, the risk step's pass that never moves a launch, and the ways it can stop.
const pathTriggers = [
  "policy_passed",
  "quote_built",
  "risk_passed",
  "pin_reported",
  "pin_failed",
  "simulation_matched",
  "simulation_failed",
  "authorization_checked",
  "confirm_tapped",
  "queue_took",
  "cancel_requested",
  "card_timer_fired",
] as const satisfies readonly TriggerType[];

type PathTrigger = (typeof pathTriggers)[number];

function triggerOf(type: PathTrigger, status: IntentStatus, nowMs: number): IntentTrigger {
  const version = status.card?.version ?? 1;
  const triggers: { readonly [K in PathTrigger]: IntentTrigger<K> } = {
    policy_passed: { type: "policy_passed" },
    quote_built: { type: "quote_built", quote: { quotedAtMs: nowMs } },
    risk_passed: { type: "risk_passed" },
    pin_reported: { type: "pin_reported" },
    pin_failed: { type: "pin_failed", reason: "pin_failed" },
    simulation_matched: { type: "simulation_matched" },
    simulation_failed: { type: "simulation_failed", reason: "effects_differ" },
    authorization_checked: {
      type: "authorization_checked",
      check: { by: "auto_mode", facts: auto },
      cards,
    },
    confirm_tapped: { type: "confirm_tapped", cardVersion: version, cards },
    queue_took: {
      type: "queue_took",
      isAgentLive: true,
      hasPolicyPassed: true,
      confirmation: { cardVersion: version, expiresAtMs: nowMs + 60_000 },
      isAuthorizationValid: true,
    },
    cancel_requested: { type: "cancel_requested", cause: "request", hasSignedStep: false },
    card_timer_fired: { type: "card_timer_fired" },
  };
  return triggers[type];
}

interface Run {
  readonly kind: IntentKind;
  readonly plan: readonly { readonly type: PathTrigger; readonly advanceMs: number }[];
}

/** The events of one history: each trigger that moved the intent, and the state it reached. */
function historyOf(run: Run): readonly Moved[] {
  const time = { nowMs: 1_000_000 };
  const machine = createIntentStateMachine({
    clock: { now: () => time.nowMs, sleep: async () => Promise.resolve() },
  });
  const proposed = machine.propose({
    kind: run.kind,
    proposer: "agent_runtime",
    isPaper: false,
    hasOutsideContent: false,
    agentStatus: "active",
  });
  const events: { trigger: string; to: string }[] = [];
  let status = proposed.ok ? proposed.value.status : undefined;
  for (const step of run.plan) {
    time.nowMs += step.advanceMs;
    const moved =
      status === undefined
        ? undefined
        : machine.apply(status, triggerOf(step.type, status, time.nowMs));
    if (moved?.ok === true) {
      events.push({ trigger: step.type, to: moved.value.status.state });
      status = moved.value.status;
    }
  }
  return events;
}

const anyStep = fc.record({ type: fc.constantFrom(...pathTriggers), advanceMs: fc.nat(30_000) });

type PlanStep = Run["plan"][number];

// A launch's path to `executing`, its pin report among it.
const path: readonly PathTrigger[] = [
  "policy_passed",
  "quote_built",
  "pin_reported",
  "simulation_matched",
  "authorization_checked",
  "confirm_tapped",
  "queue_took",
];

// Each step of the path, mostly kept, after up to two triggers of any kind.
const alongPath = fc
  .tuple(
    ...path.map((type) =>
      fc
        .tuple(
          fc.array(anyStep, { maxLength: 2 }),
          fc.oneof({ weight: 9, arbitrary: fc.constant(true) }, fc.constant(false)),
          fc.nat(5_000),
        )
        .map(([noise, isKept, advanceMs]: readonly [readonly PlanStep[], boolean, number]) =>
          isKept ? noise.concat({ type, advanceMs }) : noise,
        ),
    ),
  )
  .map((parts: readonly (readonly PlanStep[])[]) => parts.flat());

// Plans of any triggers, and plans along the path with noise and a step left out now and then.
const plans: fc.Arbitrary<Run["plan"]> = fc.oneof(fc.array(anyStep, { maxLength: 30 }), alongPath);

/** One move of a history: the trigger that moved the intent, and the state it reached. */
interface Moved {
  readonly trigger: string;
  readonly to: string;
}

// The triggers that moved the intent out of the state.
function movesOutOf(events: readonly Moved[], state: string): readonly string[] {
  return events.filter((_event, index) => events[index - 1]?.to === state).map((e) => e.trigger);
}

// Whether the history reached the state only with or after a pin report.
function reachedAfterPin(events: readonly Moved[], state: string): boolean {
  const reached = events.findIndex((event) => event.to === state);
  const pinned = events.findIndex((event) => event.trigger === "pin_reported");
  return reached === -1 || (pinned !== -1 && pinned <= reached);
}

describe("a token launch's pin", () => {
  it("comes before the card, a confirmation and `executing`, in every history", () => {
    fc.assert(
      fc.property(plans, (plan) => {
        const events = historyOf({ kind: "launchToken", plan });
        const states = ["assessed", "awaiting_confirmation", "confirmed", "executing"];
        expect(states.filter((state) => !reachedAfterPin(events, state))).toStrictEqual([]);
      }),
      { numRuns: 2_000 },
    );
  });

  it("is the only move out of `quoted` but a failure or a cancel", () => {
    fc.assert(
      fc.property(plans, (plan) => {
        const events = historyOf({ kind: "launchToken", plan });
        const allowed = new Set([
          "pin_reported",
          "pin_failed",
          "simulation_failed",
          "cancel_requested",
        ]);
        const others = movesOutOf(events, "quoted").filter((move) => !allowed.has(move));
        expect(others).toStrictEqual([]);
      }),
    );
  });

  it("never lets the auto mode confirm a launch", () => {
    fc.assert(
      fc.property(plans, (plan) => {
        const events = historyOf({ kind: "launchToken", plan });
        expect(
          events.filter((event) => event.to === "confirmed").map((e) => e.trigger),
        ).not.toContain("authorization_checked");
      }),
    );
  });

  it("never moves an intent of another kind", () => {
    const others = intentKinds.filter((kind) => kind !== "launchToken");
    fc.assert(
      fc.property(fc.constantFrom(...others), plans, (kind, plan) => {
        const events = historyOf({ kind, plan });
        const pinMoves = events.filter((event) => event.trigger.startsWith("pin_"));
        expect(pinMoves).toStrictEqual([]);
      }),
    );
  });

  it("reaches `executing` in some histories, so the first property is tested", () => {
    const runs = fc.sample(plans, { numRuns: 2_000, seed: 270 });
    const executed = runs.filter((plan) =>
      historyOf({ kind: "launchToken", plan }).some((event) => event.to === "executing"),
    );
    expect(executed.length).toBeGreaterThan(0);
  });
});
