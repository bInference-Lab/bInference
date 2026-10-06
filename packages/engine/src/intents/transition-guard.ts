import type { Result } from "@binference/core";
import type { Authorization } from "./authorization.js";
import type { IntentReason } from "./intent-reason.js";
import type { CardTerms, IntentStatus, QuoteTerms } from "./intent-status.js";
import type { CancelCause, IntentTrigger, TriggerType } from "./intent-trigger.js";

/**
 * Why the state machine refused a trigger. `terminal`: nothing leaves a terminal state.
 * `wrong_state`: no transition takes this trigger from this state. The rest name the guard that
 * failed.
 */
export type TransitionProblem =
  | "terminal"
  | "wrong_state"
  | "authorization_mismatch"
  | "fill_invalid"
  | "card_changed"
  | "expired"
  | "quote_stale"
  | "quote_worse"
  | "quote_held"
  | "not_expired"
  | "already_signed"
  | "rescue_outlasts_freeze"
  | "rescue_retries"
  | "live_intent"
  | "paper_intent"
  | "agent_not_live"
  | "policy_refused"
  | "no_confirmation"
  | "authorization_lapsed"
  | "delivery_pending";

/** What a transition writes besides the new state. */
export interface IntentChange {
  readonly reason?: IntentReason;
  readonly authorizedBy?: Authorization;
  readonly quote?: QuoteTerms;
  readonly card?: CardTerms;
  /** Recorded on the event only. */
  readonly cancelCause?: CancelCause;
}

/** What a guard reads: the intent, the trigger and the time from the Clock port. */
export interface GuardInput<K extends TriggerType> {
  readonly status: IntentStatus;
  readonly trigger: IntentTrigger<K>;
  readonly nowMs: number;
}

/**
 * Decides whether one row of the transition table applies. It is pure: it reads only its input,
 * and returns what the transition writes or the problem that stops it.
 */
export type TransitionGuard<K extends TriggerType> = (
  input: GuardInput<K>,
) => Result<IntentChange, TransitionProblem>;
