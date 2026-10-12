/**
 * Why policy refused an intent (spec 6, section 4). `price_impact` is checked after quoting, so it
 * is stored with `failed_check`; every other code is stored with `rejected_policy`. No rule stores
 * `tax` yet: the risk step measures a token's tax and refuses with `high_tax` (decision 0113).
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

/**
 * Why a quote, build, decode or simulation failed: the reason stored with `failed_check`.
 * `nothing_to_sell` is a sale by share of a token the wallet holds none of, or whose share rounds
 * to nothing, or a paper sale or swap whose paper portfolio holds less of its input at the fill
 * than its confirmed quote spends.
 */
export const checkReasons = [
  "no_route",
  "venue_down",
  "decode_mismatch",
  "simulation_reverted",
  "effects_differ",
  "price_impact",
  "nothing_to_sell",
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
 * `nonce_taken` a nonce another transaction used after a crash (section 7), `step_unsent` a
 * step never signed after an earlier one landed (decision 0109), and `stuck_dropped` a stuck step
 * every relay refused, its nonce free again (decision 0115).
 */
export const failureReasons = [
  "reverted",
  "stuck_cancelled",
  "nonce_taken",
  "step_unsent",
  "stuck_dropped",
] as const;

/** A reason a sent intent failed on chain. */
export type FailureReason = (typeof failureReasons)[number];

/**
 * Why an auto order's fill ended `failed_check` at its authorization, once its quote, risk and
 * simulation passed (spec 6, section 5): `order_inactive`, its order ended, paused, used its
 * last fill or expired meanwhile; `fill_bounds`, it would spend or sell more than the order's size
 * allows, or ask more slippage than the order's maximum; `worst_price`, its quote's price at its
 * minimum out is worse than the order's worst price, or cannot be valued; `trigger_unconfirmed`,
 * a thin pool's price fired it and its quote's own price does not meet the trigger.
 */
export const fillReasons = [
  "order_inactive",
  "fill_bounds",
  "worst_price",
  "trigger_unconfirmed",
] as const;

/** A reason an auto order's fill broke its order at its authorization. */
export type FillReason = (typeof fillReasons)[number];

/** A reason stored with a terminal state. */
export type IntentReason = PolicyReason | RiskReason | CheckReason | FailureReason | FillReason;

/**
 * Every reason code an intent can store, each once. Each code has a message `reason.<code>` in
 * English and Chinese (spec 4, section 6).
 */
export const intentReasons: readonly IntentReason[] = [
  ...new Set<IntentReason>([
    ...policyReasons,
    ...riskReasons,
    ...checkReasons,
    ...failureReasons,
    ...fillReasons,
  ]),
];

/**
 * Why an auto order skipped a fill before any intent was stored (spec 6, section 4):
 * `copy_daily_cap`, a copy order's buy that would pass its daily cap for the leader. The skip is
 * an `order_fills` row with its reason, and its message is `reason.<code>` like an intent's.
 */
export const orderSkipReasons = ["copy_daily_cap"] as const;
