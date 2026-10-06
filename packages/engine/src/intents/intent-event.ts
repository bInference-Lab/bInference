import type { IntentReason } from "./intent-reason.js";
import type { IntentState } from "./intent-state.js";
import type { CancelCause, TriggerType } from "./intent-trigger.js";

/**
 * One transition of an intent, as `intent_events` stores it. The caller adds who caused it
 * (surface, device or token) and the hashes involved before the ledger records it.
 */
export interface IntentEvent {
  /** The state before; `null` when the intent was proposed. */
  readonly from: IntentState | null;
  readonly to: IntentState;
  readonly trigger: TriggerType | "propose";
  /** Epoch milliseconds, from the Clock port. */
  readonly atMs: number;
  /** The transition writes a ledger entry (spec 6, section 8). */
  readonly hasLedgerEntry: boolean;
  readonly reason?: IntentReason;
  readonly cancelCause?: CancelCause;
}

// Spec 6, section 8: these targets write a ledger entry; every other one only pushes a change.
const ledgerStates: ReadonlySet<IntentState> = new Set<IntentState>([
  "proposed",
  "awaiting_confirmation",
  "confirmed",
  "denied",
  "expired",
  "cancelled",
  "rejected_policy",
  "risk_blocked",
  "failed_check",
  "executing",
  "reconciled",
  "paper_filled",
  "failed_onchain",
  "unknown_after_send",
]);

/** Whether a transition into this state writes a ledger entry. Every terminal state does. */
export function needsLedgerEntry(state: IntentState): boolean {
  return ledgerStates.has(state);
}
