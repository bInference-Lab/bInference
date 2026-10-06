import type { AssetRef } from "@binference/chain";
import type { Id, Ratio, Result } from "@binference/core";
import type { SimulationView } from "@binference/protocol";
import type { BuiltQuote, IntentWrite, StoredIntent } from "./confirmations/stored-intent.js";
import type { QuoteFailure, SimulationFailure } from "./intents/intent-reason.js";

/**
 * A USD price as micro-dollars per base unit of one asset: `numerator` micro-dollars buy
 * `denominator` base units. A ratio stays exact for a token worth less than a micro-dollar a unit.
 */
export type UsdPrice = Ratio;

/**
 * Gives the USD price of an asset now (decision 0059): a feed for the native coin and stablecoins,
 * the trade's own quote for other tokens. A price is above zero, with a denominator above zero. An
 * asset it cannot price, or a price too old to trust, is `no_price`, never a throw, so the policy
 * refuses the trade.
 */
export interface PriceSource {
  /** The price of one asset. Rejects with the signal's reason once the signal aborts. */
  usdPrice(
    asset: AssetRef,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<UsdPrice, "no_price">>;
}

/**
 * Keeps the intents the owner answers, and decides which answer comes first (spec 6, section 9).
 * A write lands only while the intent's row still has the version the write read, in one
 * transaction with its event, its card's closing, its confirmation and its re-quote.
 */
export interface ConfirmationStore {
  /** The intent with its row version and card rules, or `undefined` for an unknown id. */
  read(
    intent: Id<"int">,
    options: { readonly signal: AbortSignal },
  ): Promise<StoredIntent | undefined>;
  /**
   * Stores one transition and answers the intent as it now stands. A row that moved past the
   * version the write read, an unknown intent, or a second confirmation for one intent changes
   * nothing and answers `stale`.
   */
  write(
    write: IntentWrite,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<StoredIntent, "stale">>;
}

/**
 * Quotes an intent's request again when the owner taps a card whose quote is old, and builds its
 * steps from the new quote. The steps' decode matches the request, as at the first quote.
 */
export interface QuoteSource {
  /** A new quote with its steps, or why there is none. Rejects once the signal aborts. */
  requote(
    intent: Id<"int">,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<BuiltQuote, QuoteFailure>>;
}

/**
 * Simulates the steps a quote built for an intent. The balance changes must match the request,
 * with no other outflow or approval.
 */
export interface Simulator {
  /** The wallet's balance changes, or why the steps fail. Rejects once the signal aborts. */
  simulate(
    intent: Id<"int">,
    built: BuiltQuote,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<SimulationView, SimulationFailure>>;
}
