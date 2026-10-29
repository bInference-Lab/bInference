import { z } from "zod";

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

/**
 * The states a confirmed intent ends in before anything was sent or filled: a check or policy
 * refusal, a paper sale its holding no longer covers, a cancel, or an authorization that lapsed.
 * Every surface ends such an intent's card with why (spec 4, section 3.5).
 */
export const unsentEndStates: ReadonlySet<IntentState> = new Set<IntentState>([
  "failed_check",
  "rejected_policy",
  "risk_blocked",
  "cancelled",
  "expired",
]);

/** Parses an intent state. */
export const intentStateSchema: z.ZodType<IntentState, string> = z.enum(intentStates);
