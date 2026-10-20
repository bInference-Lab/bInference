/**
 * Why policy refused an intent (spec 6, section 4). `price_impact` is checked after quoting, so it
 * is stored with `failed_check`, as is `daily_cap` for a fill whose cap room went before its
 * authorization (decision 0195); every other code is stored with `rejected_policy`. No rule stores
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
  "snipe_tax",
  "high_tax",
  "high_pool_fee",
  "high_tax_with_pool_fee",
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
 * than its confirmed quote spends. `needs_launch_wallet` is a live trade on a launch's own curve
 * from a wallet that is not the agent's launch wallet, and `launch_unread` one whose curve read
 * failed as it picked the wallet or as the wallet queue took it; `launch_moved` is a launch
 * wallet's curve trade whose launchpad no longer holds the token on that curve when the queue
 * takes it, as after a graduation (decision 0218). `image_unreadable` is a token launch whose
 * picture the engine cannot read as an image of at most 5 MiB, `pin_failed` one whose launchpad
 * reported that the pin of its words and picture failed, and `pin_timeout` one whose launchpad
 * reported no pin within the pin wait (decision 0234); `upload_lost` is one a fault or a stop cut
 * short once its upload began, before it waited for its pin (decision 0237);
 * `ceiling_lacks_call` is one whose launch wallet's ceiling does not allow a call only a launch
 * wallet makes on its launchpad, such as its create call, refused before any upload (decision
 * 0271).
 */
export const checkReasons = [
  "no_route",
  "venue_down",
  "decode_mismatch",
  "simulation_reverted",
  "effects_differ",
  "price_impact",
  "nothing_to_sell",
  "balance_unread",
  "needs_launch_wallet",
  "launch_unread",
  "launch_moved",
  "image_unreadable",
  "pin_failed",
  "pin_timeout",
  "upload_lost",
  "ceiling_lacks_call",
] as const;

/** A reason a quote, build, decode or simulation failed. */
export type CheckReason = (typeof checkReasons)[number];

/** A check reason of the quote and build step. */
export type QuoteFailure = Exclude<
  CheckReason,
  "simulation_reverted" | "effects_differ" | "launch_moved" | PinFailure
>;

/** Why a token launch's pin never came: the launchpad reported a failure, or the wait ran out. */
export type PinFailure = Extract<CheckReason, "pin_failed" | "pin_timeout">;

/** Why the wallet queue could not read the contracts of a curve trade's launch (decision 0218). */
export type LaunchReadFailure = Extract<CheckReason, "launch_unread" | "launch_moved">;

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
 * a thin pool's price fired it and its quote's own price does not meet the trigger;
 * `live_fills_off`, a live fill while live fills are off, which the money path refuses on its own
 * (decision 0210), as the fills skip one before any intent; `price_stale`, a fill whose price was
 * read before a resume that came while it ran (decision 0268).
 */
export const fillReasons = [
  "order_inactive",
  "fill_bounds",
  "worst_price",
  "trigger_unconfirmed",
  "live_fills_off",
  "price_stale",
] as const;

/** A reason an auto order's fill broke its order at its authorization. */
export type FillReason = (typeof fillReasons)[number];

/**
 * What a fill's authorization ends it with: a bound of its order it breaks, or `daily_cap` when
 * the agent's other confirmations took the rolling cap's room after the fill's policy step.
 */
export type FillBreach = FillReason | Extract<PolicyReason, "daily_cap">;

/** Every breach a fill's authorization can end it with. */
export const fillBreaches: readonly FillBreach[] = [...fillReasons, "daily_cap"];

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
 * `copy_daily_cap`, a copy order's buy that would pass its daily cap for the leader;
 * `engine_locked`, the engine is locked; `nothing_to_spend`, a buy whose size comes to nothing (decision 0195); `fill_failed`, a fill that
 * threw or ran past its deadline (decision 0197), or a live one never signed; `fill_lapsed`, a live
 * fill whose grant ran out before its wallet's queue took it (decision 0210); `missed`, a DCA
 * order's period that came while the order could not buy: the engine off or locked, or its agent
 * frozen, never bought later; `late`, a DCA buy that reached the head of its agent's line of fills
 * past its period's minute; `fill_waiting`, a DCA period whose buy could not run behind a fill
 * still settling; `period_unreadable`, a DCA order whose period no longer reads, which ends it
 * (decision 0246); `share_unread`, a copy order's sale whose leader's share the leader watcher
 * could not read, `token_unreadable`, a copied trade of a token that answers no symbol or
 * decimals, `leader_unpriced`, a copied buy whose leader's spend nothing values in dollars, and
 * `copy_sale_lapsed`, a mirrored sale not sold within an hour of the leader's, `copy_too_small`, a
 * copied buy under $5, and `copy_hourly`, a copy order's eleventh buy in an hour (decision 0260). A copy order's trade past its minute is `late` too. A live order while
 * live fills are off skips with the fill reason `live_fills_off`, and a size in dollars with no USD
 * price with the policy's `no_price`. The skip is an `order_fills` row with its reason,
 * and its message is `reason.<code>` like an intent's.
 */
export const orderSkipReasons = [
  "copy_daily_cap",
  "engine_locked",
  "nothing_to_spend",
  "fill_failed",
  "fill_lapsed",
  "owner_cancelled",
  "missed",
  "late",
  "fill_waiting",
  "period_unreadable",
  "share_unread",
  "token_unreadable",
  "leader_unpriced",
  "copy_sale_lapsed",
  "copy_too_small",
  "copy_hourly",
] as const;

/** A reason an auto order skipped a fill before any intent was stored. */
export type OrderSkipReason = (typeof orderSkipReasons)[number];
