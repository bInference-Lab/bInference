import { ok, type Result } from "@binference/core";
import { authorizeIntent, openCard } from "./authorization-guards.js";
import { confirmRequote, confirmTap, expireCard, reopenCard } from "./confirmation-guards.js";
import {
  cancelIntent,
  failOnchain,
  fillOnPaper,
  reconcileFills,
  takeIntoQueue,
} from "./execution-guards.js";
import type { IntentState } from "./intent-state.js";
import { type TriggerType, triggerTypes } from "./intent-trigger.js";
import type {
  GuardInput,
  IntentChange,
  TransitionGuard,
  TransitionProblem,
} from "./transition-guard.js";

/** One row of the transition table: from these states, on its trigger, to one state. */
export interface TransitionRow<K extends TriggerType> {
  readonly from: readonly IntentState[];
  readonly to: IntentState;
  readonly guard: TransitionGuard<K>;
}

/** The transition table: the rows each trigger can take, in the order they are tried. */
export type TransitionTable = { readonly [K in TriggerType]: readonly TransitionRow<K>[] };

/** One transition the table allows, without its guard. */
export interface TransitionRule {
  readonly from: IntentState;
  readonly trigger: TriggerType;
  readonly to: IntentState;
}

const beforeSigning: readonly IntentState[] = [
  "proposed",
  "checked",
  "quoted",
  "assessed",
  "simulated",
  "awaiting_confirmation",
  "confirmed",
];

function pass(): Result<IntentChange, TransitionProblem> {
  return ok({});
}

function storeReason({
  trigger,
}: GuardInput<"policy_refused" | "quote_failed" | "risk_refused" | "simulation_failed">): Result<
  IntentChange,
  TransitionProblem
> {
  return ok({ reason: trigger.reason });
}

/**
 * The intent state machine's transition table (spec 6, section 3). Rows beyond the spec's table
 * come from its text: a reorg moves `included` back to `executing` (section 3), and reconciliation
 * ends `unknown_after_send` in `executing` or `failed_onchain` (section 7).
 */
export const transitionTable: TransitionTable = {
  policy_passed: [{ from: ["proposed"], to: "checked", guard: pass }],
  policy_refused: [{ from: ["proposed"], to: "rejected_policy", guard: storeReason }],
  quote_built: [
    { from: ["checked"], to: "quoted", guard: ({ trigger }) => ok({ quote: trigger.quote }) },
  ],
  quote_failed: [{ from: ["checked"], to: "failed_check", guard: storeReason }],
  risk_passed: [{ from: ["quoted"], to: "assessed", guard: pass }],
  risk_refused: [{ from: ["quoted"], to: "risk_blocked", guard: storeReason }],
  simulation_matched: [{ from: ["assessed"], to: "simulated", guard: pass }],
  simulation_failed: [{ from: ["assessed"], to: "failed_check", guard: storeReason }],
  authorization_checked: [
    { from: ["simulated"], to: "confirmed", guard: authorizeIntent },
    { from: ["simulated"], to: "awaiting_confirmation", guard: openCard },
  ],
  confirm_tapped: [{ from: ["awaiting_confirmation"], to: "confirmed", guard: confirmTap }],
  confirm_requoted: [
    { from: ["awaiting_confirmation"], to: "confirmed", guard: confirmRequote },
    { from: ["awaiting_confirmation"], to: "awaiting_confirmation", guard: reopenCard },
  ],
  deny_tapped: [{ from: ["awaiting_confirmation"], to: "denied", guard: pass }],
  card_timer_fired: [{ from: ["awaiting_confirmation"], to: "expired", guard: expireCard }],
  cancel_requested: [{ from: beforeSigning, to: "cancelled", guard: cancelIntent }],
  paper_fill_recorded: [{ from: ["confirmed"], to: "paper_filled", guard: fillOnPaper }],
  queue_took: [{ from: ["confirmed"], to: "executing", guard: takeIntoQueue }],
  steps_included: [{ from: ["executing"], to: "included", guard: pass }],
  step_reverted: [{ from: ["executing"], to: "failed_onchain", guard: failOnchain("reverted") }],
  step_cancelled: [
    { from: ["executing"], to: "failed_onchain", guard: failOnchain("stuck_cancelled") },
  ],
  fate_unknown: [{ from: ["executing"], to: "unknown_after_send", guard: pass }],
  finality_reached: [{ from: ["included"], to: "finalized", guard: pass }],
  reorg_seen: [{ from: ["included"], to: "executing", guard: pass }],
  sent_step_found: [{ from: ["unknown_after_send"], to: "executing", guard: pass }],
  nonce_taken: [
    {
      from: ["unknown_after_send"],
      to: "failed_onchain",
      guard: () => ok({ reason: "nonce_taken" }),
    },
  ],
  fills_reconciled: [{ from: ["finalized"], to: "reconciled", guard: reconcileFills }],
};

function rulesOf(trigger: TriggerType): readonly TransitionRule[] {
  const rows: readonly Pick<TransitionRow<TriggerType>, "from" | "to">[] = transitionTable[trigger];
  return rows.flatMap((row) => row.from.map((from) => ({ from, trigger, to: row.to })));
}

/** Every transition the table allows, one rule per source state, without the guards. */
export function listTransitions(): readonly TransitionRule[] {
  return triggerTypes.flatMap((trigger) => rulesOf(trigger));
}
