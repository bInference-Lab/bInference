import type { IntentState } from "@binference/protocol";

export { intentStates } from "@binference/protocol";
export type { IntentState } from "@binference/protocol";

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
