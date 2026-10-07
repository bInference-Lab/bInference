import type { AssetRef } from "@binference/chain";
import { type Bps, bpsPerWhole, bpsSchema, err, ok, type Result } from "@binference/core";
import type { QuoteView } from "@binference/protocol";
import type { BuiltQuote } from "../confirmations/stored-intent.js";
import type { QuoteFailure } from "../intents/intent-reason.js";
import type { TradePlan, TradeQuote, VenueHost, VenueOutcome } from "../venues/venue-host.js";
import type { SwapTrade } from "./swap-trade.js";

/** A swap the venue host quoted and built: its plan, and the quote and steps a card shows. */
export interface PlannedSwap {
  readonly plan: TradePlan;
  readonly built: BuiltQuote;
}

/** What a swap is planned with. */
export interface PlanSwapOptions {
  readonly host: VenueHost;
  /** The native coin of the trade's chain, which pays its gas. */
  readonly nativeAsset: AssetRef;
  readonly signal: AbortSignal;
}

// Rule 5: a trade call's deadline is at most 60 s after its quote, so the quote ends with it.
const quoteLifetimeMs = 60_000;
const wholeRouteBps: Bps = bpsSchema.parse(bpsPerWhole);

/**
 * The quote a card and a view show for a plan. The whole route is the venue that quoted. The
 * venue's quote carries no gas estimate, so `gas` is zero until the simulation measures it.
 */
function quoteViewOf(swap: SwapTrade, plan: TradePlan, nativeAsset: AssetRef): QuoteView {
  const { trade } = swap;
  const { quotedAtMs, minOutBase } = plan.terms;
  return {
    route: [{ venue: plan.venue, shareBps: wholeRouteBps }],
    amountIn: trade.amountIn,
    expectedOut: plan.quote.expectedOut,
    minOut: { asset: trade.assetOut, base: minOutBase ?? 0n },
    priceImpactBps: plan.quote.priceImpactBps,
    gas: { asset: nativeAsset, base: 0n },
    quotedAt: quotedAtMs,
    expiresAt: quotedAtMs + quoteLifetimeMs,
  };
}

function plannedOf(
  swap: SwapTrade,
  planned: VenueOutcome,
  nativeAsset: AssetRef,
): Result<PlannedSwap, QuoteFailure> {
  if (!planned.ok) {
    return err(planned.error);
  }
  const plan = planned.value;
  const quote = quoteViewOf(swap, plan, nativeAsset);
  return ok({ plan, built: { quote, steps: plan.steps.map((step) => step.draft) } });
}

/**
 * Quotes and builds a swap through the venue host, which checks every step it builds. A refusal
 * is the check reason the intent stores with `failed_check`.
 */
export async function planSwap(
  swap: SwapTrade,
  options: PlanSwapOptions,
): Promise<Result<PlannedSwap, QuoteFailure>> {
  const planned = await options.host.plan(swap.trade, { signal: options.signal });
  return plannedOf(swap, planned, options.nativeAsset);
}

/**
 * Builds a swap the venue host already quoted, from that quote, as {@link planSwap} does. The
 * money path quotes first, so the policy prices the trade from its quote before anything is built.
 */
export async function buildSwap(
  swap: SwapTrade,
  quoted: TradeQuote,
  options: PlanSwapOptions,
): Promise<Result<PlannedSwap, QuoteFailure>> {
  const planned = await options.host.build(quoted, { signal: options.signal });
  return plannedOf(swap, planned, options.nativeAsset);
}
