import type { Bps, Id, Result } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Authorization } from "./authorization.js";
import type { AutoModeFacts } from "./auto-mode.js";
import type { CardRules } from "./card-rules.js";
import { type IntentEvent, needsLedgerEntry } from "./intent-event.js";
import { type IntentKind, intentKinds } from "./intent-kind.js";
import {
  checkReasons,
  failureReasons,
  type IntentReason,
  policyReasons,
  riskReasons,
} from "./intent-reason.js";
import { type IntentState, intentStates, isTerminalState } from "./intent-state.js";
import type { IntentProposer, IntentStatus, QuoteTerms } from "./intent-status.js";
import {
  type AuthorizationCheck,
  type IntentTrigger,
  type QueueFacts,
  type TriggerType,
  triggerTypes,
} from "./intent-trigger.js";
import { createIntentStateMachine, type IntentProposal, type IntentStep } from "./state-machine.js";
import type { GuardInput, TransitionProblem } from "./transition-guard.js";
import { listTransitions, transitionTable } from "./transition-table.js";

const cards: CardRules = {
  tradeExpiryMs: 60_000,
  otherExpiryMs: 600_000,
  requoteAfterMs: 10_000,
  requoteToleranceBps: 50 as Bps,
};
const order = "ord_0190f1c2-3b4c-7d5e-8f60-718293a4b5c6" as Id<"ord">;
const rule = "whr_0190f1c2-3b4c-7d5e-8f60-718293a4b5c6" as Id<"whr">;
const rules = listTransitions();
const ruleKeys = new Set(rules.map((item) => `${item.from}|${item.trigger}|${item.to}`));
const autoKinds: ReadonlySet<IntentKind> = new Set(["swap", "buy", "sell", "lend", "stake"]);

// The data any trigger may need. Each step picks a trigger type and builds it from these.
interface Facts {
  readonly policyRejection: Exclude<(typeof policyReasons)[number], "price_impact">;
  readonly quoteFailure: "no_route" | "venue_down" | "decode_mismatch" | "price_impact";
  readonly riskReason: (typeof riskReasons)[number];
  readonly simulationFailure: "simulation_reverted" | "effects_differ";
  readonly quoteAgoMs: number;
  readonly minOutBase: bigint | undefined;
  readonly requoteAgoMs: number;
  readonly requoteMinOutBase: bigint | undefined;
  readonly checkMatches: boolean;
  readonly isFillValid: boolean;
  readonly auto: AutoModeFacts;
  readonly versionOffset: number;
  readonly cancelCause: "request" | "freeze" | "engine_stopping";
  readonly hasSignedStep: boolean;
  readonly isAgentLive: boolean;
  readonly hasPolicyPassed: boolean;
  readonly hasConfirmation: boolean;
  readonly confirmationTtlMs: number;
  readonly isAuthorizationValid: boolean;
  readonly isDeliveryReported: boolean;
}

interface At {
  readonly status: IntentStatus;
  readonly nowMs: number;
}

type Builders = { readonly [K in TriggerType]: (facts: Facts, at: At) => IntentTrigger<K> };

function quoteAt(nowMs: number, agoMs: number, minOutBase: bigint | undefined): QuoteTerms {
  return minOutBase === undefined
    ? { quotedAtMs: nowMs - agoMs }
    : { quotedAtMs: nowMs - agoMs, minOutBase };
}

// Mostly the check the intent expects: a fill check for a fill, auto-mode facts otherwise.
function authorizationCheck(facts: Facts, status: IntentStatus): AuthorizationCheck {
  return (status.authorizedBy !== undefined) === facts.checkMatches
    ? { by: "fill", isValid: facts.isFillValid }
    : { by: "auto_mode", facts: facts.auto };
}

function cardVersion(facts: Facts, status: IntentStatus): number {
  return (status.card?.version ?? 1) + facts.versionOffset;
}

function queueFacts(facts: Facts, at: At): QueueFacts {
  const base = {
    isAgentLive: facts.isAgentLive,
    hasPolicyPassed: facts.hasPolicyPassed,
    isAuthorizationValid: facts.isAuthorizationValid,
  };
  const confirmation = {
    cardVersion: cardVersion(facts, at.status),
    expiresAtMs: at.nowMs + facts.confirmationTtlMs,
  };
  return facts.hasConfirmation ? { ...base, confirmation } : base;
}

const builders: Builders = {
  policy_passed: () => ({ type: "policy_passed" }),
  policy_refused: (facts) => ({ type: "policy_refused", reason: facts.policyRejection }),
  quote_built: (facts, at) => ({
    type: "quote_built",
    quote: quoteAt(at.nowMs, facts.quoteAgoMs, facts.minOutBase),
  }),
  quote_failed: (facts) => ({ type: "quote_failed", reason: facts.quoteFailure }),
  risk_passed: () => ({ type: "risk_passed" }),
  risk_refused: (facts) => ({ type: "risk_refused", reason: facts.riskReason }),
  simulation_matched: () => ({ type: "simulation_matched" }),
  simulation_failed: (facts) => ({ type: "simulation_failed", reason: facts.simulationFailure }),
  authorization_checked: (facts, at) => ({
    type: "authorization_checked",
    check: authorizationCheck(facts, at.status),
    cards,
  }),
  confirm_tapped: (facts, at) => ({
    type: "confirm_tapped",
    cardVersion: cardVersion(facts, at.status),
    cards,
  }),
  confirm_requoted: (facts, at) => ({
    type: "confirm_requoted",
    cardVersion: cardVersion(facts, at.status),
    requote: quoteAt(at.nowMs, facts.requoteAgoMs, facts.requoteMinOutBase),
    cards,
  }),
  deny_tapped: () => ({ type: "deny_tapped" }),
  card_timer_fired: () => ({ type: "card_timer_fired" }),
  cancel_requested: (facts) => ({
    type: "cancel_requested",
    cause: facts.cancelCause,
    hasSignedStep: facts.hasSignedStep,
  }),
  paper_fill_recorded: () => ({ type: "paper_fill_recorded" }),
  queue_took: (facts, at) => ({ type: "queue_took", ...queueFacts(facts, at) }),
  steps_included: () => ({ type: "steps_included" }),
  step_reverted: () => ({ type: "step_reverted" }),
  step_cancelled: () => ({ type: "step_cancelled" }),
  fate_unknown: () => ({ type: "fate_unknown" }),
  finality_reached: () => ({ type: "finality_reached" }),
  reorg_seen: () => ({ type: "reorg_seen" }),
  sent_step_found: () => ({ type: "sent_step_found" }),
  nonce_taken: () => ({ type: "nonce_taken" }),
  fills_reconciled: (facts) => ({
    type: "fills_reconciled",
    isDeliveryReported: facts.isDeliveryReported,
  }),
};

function mostly<T>(usual: T, rare: T): fc.Arbitrary<T> {
  return fc.oneof(
    { weight: 9, arbitrary: fc.constant(usual) },
    { weight: 1, arbitrary: fc.constant(rare) },
  );
}

const minOut = fc.option(fc.bigInt({ min: 0n, max: 10n ** 20n }), { nil: undefined, freq: 5 });

const autoFacts: fc.Arbitrary<AutoModeFacts> = fc.record({
  approvalMode: fc.constantFrom("manual", "auto"),
  modeVersion: fc.nat(50),
  isInsideOwnPositions: fc.boolean(),
  sellsDeniedToken: mostly(false, true),
  valueUsdMicros: fc.bigInt({ min: 0n, max: 200_000_000n }),
  perTradeCapUsdMicros: fc.constant(100_000_000n),
  rollingDayCapUsdMicros: fc.constant(500_000_000n),
  rollingDaySpentUsdMicros: fc.bigInt({ min: 0n, max: 500_000_000n }),
  feePerGasNativeBase: fc.bigInt({ min: 0n, max: 2_000_000_000n }),
  networkFeeCapNativeBase: fc.constant(1_000_000_000n),
  hasUnlistedSpender: mostly(false, true),
});

const facts: fc.Arbitrary<Facts> = fc.record({
  policyRejection: fc.constantFrom(...policyReasons.filter((code) => code !== "price_impact")),
  quoteFailure: fc.constantFrom("no_route", "venue_down", "decode_mismatch", "price_impact"),
  riskReason: fc.constantFrom(...riskReasons),
  simulationFailure: fc.constantFrom("simulation_reverted", "effects_differ"),
  quoteAgoMs: fc.nat(12_000),
  minOutBase: minOut,
  requoteAgoMs: fc.nat(12_000),
  requoteMinOutBase: minOut,
  checkMatches: mostly(true, false),
  isFillValid: mostly(true, false),
  auto: autoFacts,
  versionOffset: mostly(0, -1),
  cancelCause: fc.constantFrom("request", "freeze", "engine_stopping"),
  hasSignedStep: mostly(false, true),
  isAgentLive: mostly(true, false),
  hasPolicyPassed: mostly(true, false),
  hasConfirmation: mostly(true, false),
  confirmationTtlMs: fc.integer({ min: -1_000, max: 60_000 }),
  isAuthorizationValid: mostly(true, false),
  isDeliveryReported: fc.boolean(),
});

// How a step picks its trigger: along the normal path, among the state's own rows, or any trigger.
type Route = "forward" | "own" | "any";

interface Step {
  readonly advanceMs: number;
  readonly route: Route;
  readonly pick: number;
  readonly facts: Facts;
}

const steps: fc.Arbitrary<readonly Step[]> = fc.array(
  fc.record({
    advanceMs: fc.oneof(
      { weight: 3, arbitrary: fc.constant(0) },
      { weight: 4, arbitrary: fc.nat(6_000) },
      { weight: 2, arbitrary: fc.nat(700_000) },
      { weight: 1, arbitrary: fc.constant(7_200_000) },
    ),
    route: fc.oneof(
      { weight: 7, arbitrary: fc.constant<Route>("forward") },
      { weight: 2, arbitrary: fc.constant<Route>("own") },
      { weight: 1, arbitrary: fc.constant<Route>("any") },
    ),
    pick: fc.nat(100),
    facts,
  }),
  { maxLength: 40, size: "max" },
);

const common = { isPaper: fc.boolean(), hasOutsideContent: mostly(false, true) };
const proposals: fc.Arbitrary<IntentProposal> = fc.oneof(
  fc.record({
    ...common,
    kind: fc.constantFrom(...intentKinds.filter((kind) => kind !== "rescue")),
    proposer: fc.constantFrom<IntentProposer>("agent_runtime", "mcp_client", "owner"),
    agentStatus: fc.constant("active" as const),
  }),
  fc.record({
    ...common,
    kind: fc.constantFrom<IntentKind>("swap", "buy", "sell"),
    proposer: fc.constant("engine" as const),
    agentStatus: fc.constant("active" as const),
    fill: fc.constantFrom({ order }, { webhookRule: rule, alertId: "alert-1" }),
  }),
  fc.record({
    ...common,
    kind: fc.constant("rescue" as const),
    proposer: fc.constant("owner" as const),
    agentStatus: fc.constant("active" as const),
  }),
);

function unwrap<T>(result: Result<T, string>): T {
  if (!result.ok) {
    throw new Error(`Expected a success, got ${result.error}.`);
  }
  return result.value;
}

function triggersFrom(state: IntentState): readonly TriggerType[] {
  return [...new Set(rules.filter((item) => item.from === state).map((item) => item.trigger))];
}

const forward: Readonly<Partial<Record<IntentState, readonly TriggerType[]>>> = {
  proposed: ["policy_passed"],
  checked: ["quote_built"],
  quoted: ["risk_passed"],
  assessed: ["simulation_matched"],
  simulated: ["authorization_checked"],
  awaiting_confirmation: ["confirm_tapped", "confirm_requoted"],
  confirmed: ["paper_fill_recorded", "queue_took"],
  executing: ["steps_included"],
  included: ["finality_reached"],
  finalized: ["fills_reconciled"],
  unknown_after_send: ["sent_step_found"],
};

// Most steps follow the normal path or the state's own rows, so histories reach deep states.
function poolFor(state: IntentState, route: Route): readonly TriggerType[] {
  const own = triggersFrom(state);
  if (route === "forward") {
    return forward[state] ?? triggerTypes;
  }
  return route === "own" && own.length > 0 ? own : triggerTypes;
}

function pickType(state: IntentState, step: Step): TriggerType {
  const pool = poolFor(state, step.route);
  return pool[step.pick % pool.length] ?? "policy_passed";
}

interface Outcome {
  readonly before: IntentStatus;
  readonly trigger: IntentTrigger;
  readonly nowMs: number;
  readonly result: Result<IntentStep, TransitionProblem>;
}

interface History {
  readonly first: IntentStep;
  readonly outcomes: readonly Outcome[];
  readonly events: readonly IntentEvent[];
  readonly final: IntentStatus;
  readonly afterEnd: readonly Result<IntentStep, TransitionProblem>[];
}

function runHistory(proposal: IntentProposal, plan: readonly Step[]): History {
  const time = { nowMs: 1_000_000 };
  const clock = { now: () => time.nowMs, sleep: async () => Promise.resolve() };
  const machine = createIntentStateMachine({ clock });
  const first = unwrap(machine.propose(proposal));
  const outcomes: Outcome[] = [];
  let status = first.status;
  for (const step of plan) {
    time.nowMs += step.advanceMs;
    const trigger = builders[pickType(status.state, step)](step.facts, {
      status,
      nowMs: time.nowMs,
    });
    const result = machine.apply(status, trigger);
    outcomes.push({ before: status, trigger, nowMs: time.nowMs, result });
    status = result.ok ? result.value.status : status;
  }
  const lastFacts = plan.at(-1)?.facts;
  const afterEnd =
    lastFacts === undefined
      ? []
      : triggerTypes.map((type) =>
          machine.apply(status, builders[type](lastFacts, { status, nowMs: time.nowMs })),
        );
  const events = [
    first.event,
    ...outcomes.flatMap((item) => (item.result.ok ? [item.result.value.event] : [])),
  ];
  return { first, outcomes, events, final: status, afterEnd };
}

function refusalViolations({ before, trigger, result }: Outcome): readonly string[] {
  if (result.ok) {
    return [];
  }
  if (isTerminalState(before.state)) {
    return result.error === "terminal" ? [] : [`${before.state} answered ${result.error}`];
  }
  const hasRow = triggersFrom(before.state).includes(trigger.type);
  return hasRow || result.error === "wrong_state"
    ? []
    : [`${trigger.type} from ${before.state} answered ${result.error}`];
}

function tableViolations({ before, trigger, nowMs, result }: Outcome): readonly string[] {
  if (!result.ok) {
    return [];
  }
  const { status, event } = result.value;
  const found = [
    isTerminalState(before.state) ? `left terminal ${before.state}` : "",
    ruleKeys.has(`${before.state}|${trigger.type}|${status.state}`)
      ? ""
      : `outside the table: ${before.state} -${trigger.type}-> ${status.state}`,
    event.from === before.state && event.to === status.state && event.trigger === trigger.type
      ? ""
      : "event does not match the transition",
    event.atMs === nowMs && status.changedAtMs === nowMs ? "" : "event time is not the clock's",
    event.hasLedgerEntry === needsLedgerEntry(status.state) ? "" : "ledger flag differs",
  ];
  return found.filter((text) => text !== "");
}

const reasonLists: Readonly<Partial<Record<IntentState, readonly IntentReason[]>>> = {
  rejected_policy: policyReasons.filter((code) => code !== "price_impact"),
  risk_blocked: riskReasons,
  failed_check: checkReasons,
  failed_onchain: failureReasons,
};

// Spec 6, section 4: each refusal state stores a reason from its own list; no other state has one.
function reasonViolations(status: IntentStatus): readonly string[] {
  const allowed = reasonLists[status.state];
  if (allowed === undefined) {
    return status.reason === undefined ? [] : [`${status.state} carries ${status.reason}`];
  }
  return status.reason !== undefined && allowed.includes(status.reason)
    ? []
    : [`${status.state} carries ${String(status.reason)}`];
}

function isAuto(authorization: Authorization | undefined): boolean {
  return authorization !== undefined && "approvalMode" in authorization;
}

function fitsAutoCaps(auto: AutoModeFacts): boolean {
  return (
    auto.valueUsdMicros <= auto.perTradeCapUsdMicros &&
    auto.rollingDaySpentUsdMicros + auto.valueUsdMicros <= auto.rollingDayCapUsdMicros
  );
}

function isAutoKind(status: IntentStatus, auto: AutoModeFacts): boolean {
  return (
    ["swap", "buy", "sell"].includes(status.kind) ||
    (autoKinds.has(status.kind) && auto.isInsideOwnPositions)
  );
}

function isAutoAllowed(status: IntentStatus, auto: AutoModeFacts | undefined): boolean {
  return (
    auto !== undefined &&
    auto.approvalMode === "auto" &&
    isAutoKind(status, auto) &&
    !auto.sellsDeniedToken &&
    fitsAutoCaps(auto) &&
    auto.feePerGasNativeBase <= auto.networkFeeCapNativeBase &&
    !auto.hasUnlistedSpender &&
    !status.hasOutsideContent &&
    status.proposer === "agent_runtime"
  );
}

function autoFactsOf(trigger: IntentTrigger): AutoModeFacts | undefined {
  const check = trigger.type === "authorization_checked" ? trigger.check : undefined;
  return check?.by === "auto_mode" ? check.facts : undefined;
}

// Invariant 8: an auto-authorized intent is a trade or an own-position move, inside the caps and
// the network fee cap, selling no denied token, with no new spender, no outside content and no
// proposer but the agent runtime.
function autoViolations({ before, trigger, result }: Outcome): readonly string[] {
  if (!result.ok || isAuto(before.authorizedBy) || !isAuto(result.value.status.authorizedBy)) {
    return [];
  }
  const { status } = result.value;
  return isAutoAllowed(status, autoFactsOf(trigger))
    ? []
    : [`auto mode authorized a ${status.kind} it must not`];
}

function hasValidConfirmation(before: IntentStatus, queue: QueueFacts, nowMs: number): boolean {
  const { confirmation } = queue;
  return (
    confirmation !== undefined &&
    confirmation.cardVersion === before.card?.version &&
    nowMs < confirmation.expiresAtMs
  );
}

function isApprovedForQueue(before: IntentStatus, trigger: IntentTrigger, nowMs: number): boolean {
  if (trigger.type !== "queue_took" || before.isPaper) {
    return false;
  }
  return before.authorizedBy === undefined
    ? hasValidConfirmation(before, trigger, nowMs)
    : trigger.isAuthorizationValid === true;
}

// Invariants 2 and 3: the queue takes only a live intent, with an unexpired confirmation of its
// current card or an authorization that still holds.
function signingViolations({ before, trigger, nowMs, result }: Outcome): readonly string[] {
  if (!result.ok || result.value.status.state !== "executing" || before.state !== "confirmed") {
    return [];
  }
  return isApprovedForQueue(before, trigger, nowMs) ? [] : ["executing without a valid approval"];
}

function cancelViolations({ before, trigger, result }: Outcome): readonly string[] {
  if (!result.ok || result.value.status.state !== "cancelled") {
    return [];
  }
  const cancel = trigger.type === "cancel_requested" ? trigger : undefined;
  const isAllowed =
    cancel !== undefined &&
    !cancel.hasSignedStep &&
    !(cancel.cause === "freeze" && before.kind === "rescue");
  return isAllowed ? [] : ["cancelled a signed intent or a rescue on a freeze"];
}

// Invariant 7: an intent that ends has exactly one ledger entry for its terminal state.
function ledgerViolations({ events, final }: History): readonly string[] {
  const terminalEntries = events.filter(
    (event) => isTerminalState(event.to) && event.hasLedgerEntry,
  ).length;
  const wanted = isTerminalState(final.state) ? 1 : 0;
  return terminalEntries === wanted ? [] : [`${String(terminalEntries)} terminal ledger entries`];
}

function pathViolations({ events, final }: History): readonly string[] {
  const states = events.map((event) => event.to);
  const firstExecuting = states.indexOf("executing");
  const firstConfirmed = states.indexOf("confirmed");
  return [
    final.isPaper && states.includes("executing") ? "a paper intent executed" : "",
    final.kind === "rescue" && (final.isPaper || states.includes("paper_filled"))
      ? "a rescue ran on paper"
      : "",
    firstExecuting !== -1 && (firstConfirmed === -1 || firstConfirmed > firstExecuting)
      ? "executing before confirmed"
      : "",
  ].filter((text) => text !== "");
}

function endViolations({ final, afterEnd }: History): readonly string[] {
  if (!isTerminalState(final.state)) {
    return [];
  }
  return afterEnd.every((result) => !result.ok && result.error === "terminal")
    ? []
    : [`a trigger left ${final.state}`];
}

function violations(history: History): readonly string[] {
  return [
    ...history.outcomes.flatMap((outcome) => [
      ...refusalViolations(outcome),
      ...tableViolations(outcome),
      ...autoViolations(outcome),
      ...signingViolations(outcome),
      ...cancelViolations(outcome),
      ...reasonViolations(outcome.result.ok ? outcome.result.value.status : outcome.before),
    ]),
    ...ledgerViolations(history),
    ...pathViolations(history),
    ...endViolations(history),
  ];
}

function missingTerminalStates(reached: ReadonlySet<IntentState>): readonly IntentState[] {
  return intentStates.filter((state) => isTerminalState(state) && !reached.has(state));
}

function nonTerminalAnswers(
  results: readonly Result<IntentStep, TransitionProblem>[],
): readonly Result<IntentStep, TransitionProblem>[] {
  return results.filter((result) => result.ok || result.error !== "terminal");
}

describe("intent histories", () => {
  it("never leave a terminal state or the table, and keep the invariants of spec 6", () => {
    fc.assert(
      fc.property(proposals, steps, (proposal, plan) => {
        expect(violations(runHistory(proposal, plan))).toStrictEqual([]);
      }),
      { numRuns: 600 },
    );
  });

  it("reach every terminal state, so the properties above cover each one", () => {
    const runs = fc.sample(fc.record({ proposal: proposals, plan: steps }), {
      numRuns: 400,
      seed: 6,
    });
    const reached = new Set(
      runs.map(
        (run: Readonly<{ proposal: IntentProposal; plan: readonly Step[] }>) =>
          runHistory(run.proposal, run.plan).final.state,
      ),
    );
    expect(missingTerminalStates(reached)).toStrictEqual([]);
  });
});

const authorizations: fc.Arbitrary<Authorization> = fc.constantFrom(
  { order },
  { webhookRule: rule, alertId: "alert-1" },
  { approvalMode: "auto" as const, modeVersion: 1 },
);

const statuses: fc.Arbitrary<IntentStatus> = fc.record(
  {
    state: fc.constantFrom(...intentStates),
    kind: fc.constantFrom(...intentKinds),
    proposer: fc.constantFrom<IntentProposer>("agent_runtime", "mcp_client", "owner", "engine"),
    isPaper: fc.boolean(),
    hasOutsideContent: fc.boolean(),
    changedAtMs: fc.nat(10_000_000),
    authorizedBy: authorizations,
    quote: fc
      .record({ quotedAtMs: fc.nat(10_000_000), minOutBase: minOut })
      .map((quote) => quoteAt(quote.quotedAtMs, 0, quote.minOutBase)),
    card: fc.record({
      version: fc.integer({ min: 1, max: 3 }),
      openedAtMs: fc.nat(10_000_000),
      expiresAtMs: fc.nat(10_000_000),
    }),
  },
  { requiredKeys: ["state", "kind", "proposer", "isPaper", "hasOutsideContent", "changedAtMs"] },
);

function passingRows<K extends TriggerType>(input: GuardInput<K>): number {
  return transitionTable[input.trigger.type].filter(
    (row) => row.from.includes(input.status.state) && row.guard(input).ok,
  ).length;
}

describe("transition guards", () => {
  it("let at most one row pass for any intent, trigger and time", () => {
    fc.assert(
      fc.property(statuses, facts, fc.nat(10_000_000), (status, generated, nowMs) => {
        const counts = triggerTypes.map((type) =>
          passingRows({ status, trigger: builders[type](generated, { status, nowMs }), nowMs }),
        );
        expect(Math.max(...counts)).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("refuse every trigger on an intent in a terminal state", () => {
    const machine = createIntentStateMachine({
      clock: { now: () => 0, sleep: async () => Promise.resolve() },
    });
    const ended = statuses.filter((status) => isTerminalState(status.state));
    fc.assert(
      fc.property(ended, facts, (status, generated) => {
        const results = triggerTypes.map((type) =>
          machine.apply(status, builders[type](generated, { status, nowMs: 0 })),
        );
        expect(nonTerminalAnswers(results)).toStrictEqual([]);
      }),
    );
  });
});
