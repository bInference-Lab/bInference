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

/** A state of an intent. Only the intent state machine moves an intent between states. */
export type IntentState = (typeof intentStates)[number];

/**
 * The states nothing leaves. `unknown_after_send` is not one of them: reconciliation ends it in
 * `reconciled` or `failed_onchain`.
 */
export const terminalStates = [
  "reconciled",
  "paper_filled",
  "rejected_policy",
  "risk_blocked",
  "failed_check",
  "denied",
  "expired",
  "cancelled",
  "failed_onchain",
] as const;

/** A state that ends an intent. */
export type TerminalState = (typeof terminalStates)[number];

const terminal: ReadonlySet<IntentState> = new Set<IntentState>(terminalStates);

/** Whether no transition leaves this state. */
export function isTerminalState(state: IntentState): state is TerminalState {
  return terminal.has(state);
}
