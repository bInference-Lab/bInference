/**
 * Why policy refused an intent (spec 6, section 4). `price_impact` is checked after quoting, so it
 * is stored with `failed_check`; every other code is stored with `rejected_policy`.
 */
export const policyReasons = [
  "frozen",
  "paper_only",
  "per_trade_cap",
  "ceiling",
  "daily_cap",
  "gas_reserve",
  "slippage",
  "price_impact",
  "tax",
  "venue_off",
  "token_denied",
  "send_level",
  "unsaved_address",
  "outside_content_send",
  "health_factor",
  "no_price",
] as const;

/** A reason policy refused an intent. */
export type PolicyReason = (typeof policyReasons)[number];

/** A policy reason the policy step stores with `rejected_policy`, before any quote exists. */
export type PolicyRejection = Exclude<PolicyReason, "price_impact">;

/** Why token risk refused an intent: the reason stored with `risk_blocked`. */
export const riskReasons = [
  "honeypot",
  "cannot_sell",
  "hidden_owner",
  "high_tax",
  "low_liquidity",
  "sources_down",
  "blacklisted",
] as const;

/** A reason token risk refused an intent. */
export type RiskReason = (typeof riskReasons)[number];

/** Why a quote, build, decode or simulation failed: the reason stored with `failed_check`. */
export const checkReasons = [
  "no_route",
  "venue_down",
  "decode_mismatch",
  "simulation_reverted",
  "effects_differ",
  "price_impact",
] as const;

/** A reason a quote, build, decode or simulation failed. */
export type CheckReason = (typeof checkReasons)[number];

/** A check reason of the quote and build step. */
export type QuoteFailure = Exclude<CheckReason, "simulation_reverted" | "effects_differ">;

/** A check reason of the simulation step. */
export type SimulationFailure = Extract<CheckReason, "simulation_reverted" | "effects_differ">;

/**
 * Why a sent intent failed on chain: the reason stored with `failed_onchain`. `reverted` is a
 * receipt with status 0, `stuck_cancelled` a stuck step replaced by a cancel (spec 6, section 6),
 * `nonce_taken` a nonce another transaction used after a crash (section 7), and `step_unsent` a
 * step never signed after an earlier one landed (decision 0109).
 */
export const failureReasons = [
  "reverted",
  "stuck_cancelled",
  "nonce_taken",
  "step_unsent",
] as const;

/** A reason a sent intent failed on chain. */
export type FailureReason = (typeof failureReasons)[number];

/** A reason stored with a terminal state. */
export type IntentReason = PolicyReason | RiskReason | CheckReason | FailureReason;

/**
 * Every reason code an intent can store, each once. Each code has a message `reason.<code>` in
 * English and Chinese (spec 4, section 6).
 */
export const intentReasons: readonly IntentReason[] = [
  ...new Set<IntentReason>([...policyReasons, ...riskReasons, ...checkReasons, ...failureReasons]),
];
