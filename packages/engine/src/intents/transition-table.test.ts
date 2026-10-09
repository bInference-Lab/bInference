import { describe, expect, it } from "vitest";
import { type IntentState, intentStates, isTerminalState } from "./intent-state.js";
import { triggerTypes } from "./intent-trigger.js";
import { listTransitions, type TransitionRule, transitionTable } from "./transition-table.js";

const beforeSigning: readonly IntentState[] = [
  "proposed",
  "checked",
  "quoted",
  "assessed",
  "simulated",
  "awaiting_confirmation",
  "confirmed",
];

// Spec 6, section 3, row by row, then the rows its text adds (sections 3 and 7).
const expected: readonly (readonly [IntentState, string, IntentState])[] = [
  ["proposed", "policy_passed", "checked"],
  ["proposed", "policy_refused", "rejected_policy"],
  ["checked", "quote_built", "quoted"],
  ["checked", "quote_failed", "failed_check"],
  ["quoted", "risk_passed", "assessed"],
  ["quoted", "risk_refused", "risk_blocked"],
  ["assessed", "simulation_matched", "simulated"],
  ["assessed", "simulation_failed", "failed_check"],
  ["simulated", "authorization_checked", "awaiting_confirmation"],
  ["simulated", "authorization_checked", "confirmed"],
  ["awaiting_confirmation", "confirm_requoted", "awaiting_confirmation"],
  ["awaiting_confirmation", "confirm_tapped", "confirmed"],
  ["awaiting_confirmation", "confirm_requoted", "confirmed"],
  ["awaiting_confirmation", "deny_tapped", "denied"],
  ["awaiting_confirmation", "card_timer_fired", "expired"],
  ...beforeSigning.map((from) => [from, "cancel_requested", "cancelled"] as const),
  ["confirmed", "paper_fill_recorded", "paper_filled"],
  ["confirmed", "queue_took", "executing"],
  ["executing", "steps_included", "included"],
  ["executing", "step_reverted", "failed_onchain"],
  ["executing", "step_cancelled", "failed_onchain"],
  ["executing", "fate_unknown", "unknown_after_send"],
  ["included", "finality_reached", "finalized"],
  ["finalized", "fills_reconciled", "reconciled"],
  ["included", "reorg_seen", "executing"],
  ["unknown_after_send", "sent_step_found", "executing"],
  ["unknown_after_send", "nonce_taken", "failed_onchain"],
  ["executing", "step_unsent", "cancelled"],
  ["executing", "step_unsent", "failed_onchain"],
];

function key(rule: TransitionRule): string {
  return `${rule.from} -${rule.trigger}-> ${rule.to}`;
}

function reachableFrom(start: IntentState): ReadonlySet<IntentState> {
  const rules = listTransitions();
  const visit = (seen: ReadonlySet<IntentState>): ReadonlySet<IntentState> => {
    const next = new Set([
      ...seen,
      ...rules.filter((rule) => seen.has(rule.from)).map((rule) => rule.to),
    ]);
    return next.size === seen.size ? seen : visit(next);
  };
  return visit(new Set([start]));
}

describe("the transition table", () => {
  it("holds exactly the transitions of spec 6 and no other", () => {
    const actual = listTransitions().map(key).toSorted();
    const wanted = expected.map(([from, trigger, to]) => `${from} -${trigger}-> ${to}`).toSorted();
    expect(actual).toStrictEqual(wanted);
  });

  it("has rows for every trigger type and only for them", () => {
    expect(Object.keys(transitionTable).toSorted()).toStrictEqual([...triggerTypes].toSorted());
  });

  it("leaves no way out of a terminal state", () => {
    expect(listTransitions().filter((rule) => isTerminalState(rule.from))).toStrictEqual([]);
  });

  it("gives every other state a way out", () => {
    const open = intentStates.filter((state) => !isTerminalState(state));
    const sources = new Set(listTransitions().map((rule) => rule.from));
    expect(open.filter((state) => !sources.has(state))).toStrictEqual([]);
  });

  it("reaches every state from proposed", () => {
    expect([...reachableFrom("proposed")].toSorted()).toStrictEqual([...intentStates].toSorted());
  });

  it("cancels from executing only on a step that was never signed, and never later", () => {
    const cancels = listTransitions().filter((rule) => rule.to === "cancelled");
    expect(cancels.map((rule) => [rule.from, rule.trigger])).toStrictEqual([
      ...beforeSigning.map((from) => [from, "cancel_requested"]),
      ["executing", "step_unsent"],
    ]);
  });

  it("enters executing only from confirmed, a reorg or a found step", () => {
    const into = listTransitions().filter((rule) => rule.to === "executing");
    expect(into.map((rule) => rule.from).toSorted()).toStrictEqual([
      "confirmed",
      "included",
      "unknown_after_send",
    ]);
  });
});
