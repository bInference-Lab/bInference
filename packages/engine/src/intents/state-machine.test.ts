import type { Bps, Clock, Id, Result } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { AutoModeFacts } from "./auto-mode.js";
import type { CardRules } from "./card-rules.js";
import type { IntentState } from "./intent-state.js";
import type { IntentStatus } from "./intent-status.js";
import type { IntentTrigger } from "./intent-trigger.js";
import {
  createIntentStateMachine,
  type IntentProposal,
  type IntentStateMachine,
  type IntentStep,
} from "./state-machine.js";

const cards: CardRules = {
  tradeExpiryMs: 60_000,
  otherExpiryMs: 600_000,
  requoteAfterMs: 10_000,
  requoteToleranceBps: 50 as Bps,
};

const autoFacts: AutoModeFacts = {
  approvalMode: "auto",
  modeVersion: 4,
  isInsideOwnPositions: false,
  valueUsdMicros: 20_000_000n,
  perTradeCapUsdMicros: 100_000_000n,
  rollingDayCapUsdMicros: 500_000_000n,
  rollingDaySpentUsdMicros: 0n,
  hasUnlistedSpender: false,
};

const manualFacts: AutoModeFacts = { ...autoFacts, approvalMode: "manual" };
const order = "ord_0190f1c2-3b4c-7d5e-8f60-718293a4b5c6" as Id<"ord">;

const swap: IntentProposal = {
  kind: "swap",
  proposer: "agent_runtime",
  isPaper: false,
  hasOutsideContent: false,
  agentStatus: "active",
};

function clockAt(nowMs: number): Clock {
  return { now: () => nowMs, sleep: async () => Promise.resolve() };
}

function machineAt(nowMs: number): IntentStateMachine {
  return createIntentStateMachine({ clock: clockAt(nowMs) });
}

function unwrap<T>(result: Result<T, string>): T {
  if (!result.ok) {
    throw new Error(`Expected a success, got ${result.error}.`);
  }
  return result.value;
}

function statusAt(state: IntentState, extra: Partial<IntentStatus> = {}): IntentStatus {
  return {
    state,
    kind: "swap",
    proposer: "agent_runtime",
    isPaper: false,
    hasOutsideContent: false,
    changedAtMs: 0,
    ...extra,
  };
}

// Applies each trigger in turn, one second apart, and returns every step.
function run(
  start: IntentStatus,
  triggers: readonly IntentTrigger[],
  startMs = 1_000,
): readonly IntentStep[] {
  return triggers.reduce<readonly IntentStep[]>((steps, trigger, index) => {
    const status = steps.at(-1)?.status ?? start;
    return [...steps, unwrap(machineAt(startMs + index * 1_000).apply(status, trigger))];
  }, []);
}

const toSimulated: readonly IntentTrigger[] = [
  { type: "policy_passed" },
  { type: "quote_built", quote: { quotedAtMs: 1_500, minOutBase: 990_000n } },
  { type: "risk_passed" },
  { type: "simulation_matched" },
];

const afterConfirmed: readonly IntentTrigger[] = [
  { type: "queue_took", isAgentLive: true, hasPolicyPassed: true, isAuthorizationValid: true },
  { type: "steps_included" },
  { type: "finality_reached" },
  { type: "fills_reconciled" },
];

describe("proposing an intent", () => {
  it("stores a valid proposal as proposed with a ledger event", () => {
    const step = unwrap(machineAt(7_000).propose(swap));
    expect(step.status).toStrictEqual({
      state: "proposed",
      kind: "swap",
      proposer: "agent_runtime",
      isPaper: false,
      hasOutsideContent: false,
      changedAtMs: 7_000,
    });
    expect(step.event).toStrictEqual({
      from: null,
      to: "proposed",
      trigger: "propose",
      atMs: 7_000,
      hasLedgerEntry: true,
    });
  });

  it("refuses an agent that is missing or archived", () => {
    const machine = machineAt(0);
    expect(machine.propose({ ...swap, agentStatus: "missing" })).toStrictEqual({
      ok: false,
      error: "agent_missing",
    });
    expect(machine.propose({ ...swap, agentStatus: "archived" })).toStrictEqual({
      ok: false,
      error: "agent_archived",
    });
  });

  it("keeps a fill's order as its authorization when the engine proposes it", () => {
    const fill = { ...swap, proposer: "engine", fill: { order } } as const;
    expect(unwrap(machineAt(0).propose(fill)).status.authorizedBy).toStrictEqual({ order });
  });

  it("refuses a fill from anyone but the engine, and an engine proposal without a fill", () => {
    const machine = machineAt(0);
    const refused = { ok: false, error: "wrong_proposer" };
    expect(machine.propose({ ...swap, fill: { order } })).toStrictEqual(refused);
    expect(machine.propose({ ...swap, proposer: "engine" })).toStrictEqual(refused);
  });

  it("stores a rescue as live while the agent is in paper mode", () => {
    const rescue: IntentProposal = { ...swap, kind: "rescue", proposer: "owner", isPaper: true };
    expect(unwrap(machineAt(0).propose(rescue)).status.isPaper).toBe(false);
    expect(unwrap(machineAt(0).propose({ ...swap, isPaper: true })).status.isPaper).toBe(true);
  });

  it("accepts a rescue only from the owner", () => {
    const machine = machineAt(0);
    const rescue: IntentProposal = { ...swap, kind: "rescue", proposer: "owner" };
    expect(unwrap(machine.propose(rescue)).status.kind).toBe("rescue");
    expect(machine.propose({ ...rescue, proposer: "mcp_client" })).toStrictEqual({
      ok: false,
      error: "wrong_proposer",
    });
  });
});

describe("moving an intent", () => {
  it("runs a tapped live swap from proposed to reconciled", () => {
    const steps = run(statusAt("proposed"), [
      ...toSimulated,
      { type: "authorization_checked", check: { by: "auto_mode", facts: manualFacts }, cards },
      { type: "confirm_tapped", cardVersion: 1, cards },
      {
        type: "queue_took",
        isAgentLive: true,
        hasPolicyPassed: true,
        confirmation: { cardVersion: 1, expiresAtMs: 60_000 },
      },
      ...afterConfirmed.slice(1),
    ]);
    expect(steps.map((step) => step.event.to)).toStrictEqual([
      "checked",
      "quoted",
      "assessed",
      "simulated",
      "awaiting_confirmation",
      "confirmed",
      "executing",
      "included",
      "finalized",
      "reconciled",
    ]);
    expect(steps.map((step) => step.event.hasLedgerEntry)).toStrictEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  it("records each event with its source state, trigger and time", () => {
    const [first, second] = run(statusAt("proposed"), toSimulated, 3_000);
    expect(first?.event).toStrictEqual({
      from: "proposed",
      to: "checked",
      trigger: "policy_passed",
      atMs: 3_000,
      hasLedgerEntry: false,
    });
    expect(second?.status).toMatchObject({
      state: "quoted",
      changedAtMs: 4_000,
      quote: { quotedAtMs: 1_500, minOutBase: 990_000n },
    });
  });

  it("runs an auto-mode swap past the card", () => {
    const steps = run(statusAt("proposed"), [
      ...toSimulated,
      { type: "authorization_checked", check: { by: "auto_mode", facts: autoFacts }, cards },
      ...afterConfirmed,
    ]);
    expect(steps.map((step) => step.event.to)).not.toContain("awaiting_confirmation");
    expect(steps.at(-1)?.status).toMatchObject({
      state: "reconciled",
      authorizedBy: { approvalMode: "auto", modeVersion: 4 },
    });
  });

  it("fills a paper intent at its quote and never executes it", () => {
    const paper = statusAt("proposed", { isPaper: true });
    const steps = run(paper, [
      ...toSimulated,
      { type: "authorization_checked", check: { by: "auto_mode", facts: autoFacts }, cards },
      { type: "paper_fill_recorded" },
    ]);
    expect(steps.at(-1)?.event).toMatchObject({ to: "paper_filled", hasLedgerEntry: true });
  });

  it("sends a rescue tapped in paper mode instead of filling it on paper", () => {
    const rescue = statusAt("confirmed", {
      kind: "rescue",
      proposer: "owner",
      card: { version: 1, openedAtMs: 0, expiresAtMs: 600_000 },
    });
    expect(machineAt(1_000).apply(rescue, { type: "paper_fill_recorded" })).toStrictEqual({
      ok: false,
      error: "live_intent",
    });
    const taken = machineAt(1_000).apply(rescue, {
      type: "queue_took",
      isAgentLive: false,
      hasPolicyPassed: true,
      confirmation: { cardVersion: 1, expiresAtMs: 600_000 },
    });
    expect(unwrap(taken).status.state).toBe("executing");
  });

  it("stores the reason of each refusal on the intent and its event", () => {
    const cases = [
      ["proposed", { type: "policy_refused", reason: "daily_cap" }, "rejected_policy"],
      ["checked", { type: "quote_failed", reason: "price_impact" }, "failed_check"],
      ["quoted", { type: "risk_refused", reason: "honeypot" }, "risk_blocked"],
      ["assessed", { type: "simulation_failed", reason: "effects_differ" }, "failed_check"],
      ["executing", { type: "step_reverted" }, "failed_onchain"],
      ["executing", { type: "step_cancelled" }, "failed_onchain"],
      ["unknown_after_send", { type: "nonce_taken" }, "failed_onchain"],
    ] as const;
    const outcomes = cases.map(([from, trigger]) => {
      const step = unwrap(machineAt(0).apply(statusAt(from), trigger));
      return [step.status.state, step.status.reason, step.event.reason];
    });
    expect(outcomes).toStrictEqual([
      ["rejected_policy", "daily_cap", "daily_cap"],
      ["failed_check", "price_impact", "price_impact"],
      ["risk_blocked", "honeypot", "honeypot"],
      ["failed_check", "effects_differ", "effects_differ"],
      ["failed_onchain", "reverted", "reverted"],
      ["failed_onchain", "stuck_cancelled", "stuck_cancelled"],
      ["failed_onchain", "nonce_taken", "nonce_taken"],
    ]);
  });

  it("records why an intent was cancelled on its event", () => {
    const trigger: IntentTrigger = {
      type: "cancel_requested",
      cause: "freeze",
      hasSignedStep: false,
    };
    const step = unwrap(machineAt(0).apply(statusAt("confirmed"), trigger));
    expect(step.event).toMatchObject({ to: "cancelled", cancelCause: "freeze" });
    expect(step.status).not.toHaveProperty("cancelCause");
    const plain = unwrap(machineAt(0).apply(statusAt("proposed"), { type: "policy_passed" }));
    expect(plain.event).not.toHaveProperty("cancelCause");
  });

  it("moves an included intent back to executing on a reorg", () => {
    const [back, again] = run(statusAt("included"), [
      { type: "reorg_seen" },
      { type: "steps_included" },
    ]);
    expect([back?.event.to, again?.event.to]).toStrictEqual(["executing", "included"]);
  });

  it("ends an unknown fate in executing when the step is ours, else failed_onchain", () => {
    const unknown = run(statusAt("executing"), [{ type: "fate_unknown" }])[0];
    expect(unknown?.event).toMatchObject({ to: "unknown_after_send", hasLedgerEntry: true });
    const found = unwrap(
      machineAt(0).apply(statusAt("unknown_after_send"), { type: "sent_step_found" }),
    );
    expect(found.status.state).toBe("executing");
  });
});

describe("refusing a trigger", () => {
  it("lets nothing leave a terminal state", () => {
    const machine = machineAt(0);
    const trigger: IntentTrigger = {
      type: "cancel_requested",
      cause: "request",
      hasSignedStep: false,
    };
    expect(machine.apply(statusAt("denied"), trigger)).toStrictEqual({
      ok: false,
      error: "terminal",
    });
    expect(machine.apply(statusAt("reconciled"), { type: "reorg_seen" })).toStrictEqual({
      ok: false,
      error: "terminal",
    });
  });

  it("refuses a trigger with no row from the intent's state", () => {
    const machine = machineAt(0);
    expect(machine.apply(statusAt("proposed"), { type: "risk_passed" })).toStrictEqual({
      ok: false,
      error: "wrong_state",
    });
    expect(machine.apply(statusAt("unknown_after_send"), { type: "steps_included" })).toStrictEqual(
      { ok: false, error: "wrong_state" },
    );
  });

  it("answers with the first row's problem when no guard passes", () => {
    const fill = statusAt("simulated", { authorizedBy: { order }, proposer: "engine" });
    const trigger: IntentTrigger = {
      type: "authorization_checked",
      check: { by: "fill", isValid: false },
      cards,
    };
    expect(machineAt(0).apply(fill, trigger)).toStrictEqual({ ok: false, error: "fill_invalid" });
  });
});
