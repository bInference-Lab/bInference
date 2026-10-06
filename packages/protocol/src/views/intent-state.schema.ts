/**
 * Every state an intent can be in (spec 6, section 2): the normal path first, then the terminal
 * states that end it early, then `unknown_after_send`.
 */
export const intentStates = [
  "proposed",
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
  "paper_filled",
  "rejected_policy",
  "risk_blocked",
  "failed_check",
  "denied",
  "expired",
  "cancelled",
  "failed_onchain",
  "unknown_after_send",
] as const;

/** A state of an intent. Only the engine's intent state machine moves an intent between states. */
export type IntentState = (typeof intentStates)[number];
