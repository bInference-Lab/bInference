import type { AssetRef } from "@binference/chain";
import type { Id } from "@binference/core";
import type { QuoteView, TradePlace } from "@binference/protocol";
import type { QuoteFailure } from "../intents/intent-reason.js";
import type { VenueHost } from "../venues/venue-host.js";
import { shareAmountBase } from "./share-amount.js";
import { type SwapContext, type SwapTrade, swapTradeOf, type TradeAsk } from "./swap-trade.js";
import type { Holdings } from "./wallet-facts.js";

/** What a trade is placed with: the venues, the wallet and its holdings, and the chain's coin. */
export interface PlaceContext extends SwapContext {
  readonly host: VenueHost;
  /** The native coin of the trade's chain: what a sale in the pools receives by default. */
  readonly nativeAsset: AssetRef;
  /** What the wallet holds: on chain for a live intent, in the paper portfolio for a paper one. */
  readonly holdings: Holdings;
  readonly wallet: Id<"wal">;
  /** The intent runs on paper. */
  readonly isPaper: boolean;
  readonly signal: AbortSignal;
}

/**
 * A trade with its place and its amount settled. A refusal is the check reason the intent ends
 * with, once the policy has judged the trade: no venue is asked for it.
 */
export interface PlacedTrade {
  /** The trade the policy judges and, without a refusal, the venues quote. */
  readonly swap: SwapTrade;
  readonly refusal?: QuoteFailure;
}

/** Where a trade goes: its place, the venues to ask, what it buys, and why it cannot go. */
interface Placement {
  readonly place?: TradePlace;
  readonly venues: readonly string[];
  readonly assetOut: AssetRef;
  readonly refusal?: QuoteFailure;
}

// A token on a launchpad's curve trades there and nowhere else, against what the curve takes: a
// spend or a receive of anything else has no route. A launchpad outside the agent's venues is
// still the place, so the policy refuses it as `venue_off`, and it is never asked.
function onCurve(
  ask: TradeAsk,
  claim: { readonly launchpad: string; readonly quoteAsset: AssetRef },
  allowed: readonly string[],
): Placement {
  const { launchpad, quoteAsset } = claim;
  const place: TradePlace = { kind: "curve", launchpad };
  const assetOut = ask.assetOut ?? quoteAsset;
  const curveSide = ask.kind === "buy" ? ask.assetIn : assetOut;
  const isAllowed = allowed.includes(launchpad);
  const placement = { place, venues: isAllowed ? [launchpad] : [], assetOut };
  return isAllowed && curveSide === quoteAsset ? placement : { ...placement, refusal: "no_route" };
}

// Spec 6, section 5: the launchpad that holds the token on its curve takes the trade; with none,
// the aggregators among the agent's venues quote it in the pools. A swap asks every venue.
async function placementOf(ask: TradeAsk, context: PlaceContext): Promise<Placement> {
  const { limits, host, nativeAsset, signal } = context;
  if (ask.placed === undefined) {
    return { venues: limits.venues, assetOut: ask.assetOut ?? nativeAsset };
  }
  const pools: Placement = {
    place: { kind: "pools" },
    venues: limits.venues.filter((venue) => !host.isLaunchpad(venue)),
    assetOut: ask.assetOut ?? nativeAsset,
  };
  const curves = await host.curves(ask.placed, { signal });
  if (!curves.ok) {
    return { ...pools, refusal: curves.error };
  }
  const [claim, second] = curves.value;
  if (second !== undefined) {
    return { ...pools, refusal: "no_route" };
  }
  if (claim !== undefined) {
    return onCurve(ask, claim, limits.venues);
  }
  return pools.venues.length === 0 ? { ...pools, refusal: "no_route" } : pools;
}

// What the wallet holds of the asset a sale by share sells, now, in the intent's mode; `undefined`
// when the balance read has no entry for it.
async function heldOf(ask: TradeAsk, context: PlaceContext): Promise<bigint | undefined> {
  const { wallet, account, isPaper, signal } = context;
  const query = { wallet, account, isPaper, asset: ask.assetIn };
  return context.holdings.held(query, { signal });
}

// A sale by share of a balance the read had no entry for is `balance_unread`; a share of nothing,
// or one that rounds to nothing, `nothing_to_sell`.
function shareRefusal(share: {
  readonly held: bigint | undefined;
  readonly amountInBase: bigint;
  readonly isShare: boolean;
}): QuoteFailure | undefined {
  if (!share.isShare) {
    return undefined;
  }
  if (share.held === undefined) {
    return "balance_unread";
  }
  return share.amountInBase === 0n ? "nothing_to_sell" : undefined;
}

/**
 * Settles a trade's place and amount when its quote is built (spec 6, section 5). A buy or a sell
 * goes to the curve of the one launchpad that holds its token, or else to the pools; two
 * launchpads that claim one token, or a launchpad whose claim cannot be read, refuse it. A sale by
 * share sells that share of what the wallet holds now, rounded down, so never more than it holds;
 * a share of nothing, or one that rounds to nothing, is `nothing_to_sell`, and a share of a balance
 * the chain's answer had no entry for is `balance_unread` (decision 0197).
 */
export async function placeTrade(ask: TradeAsk, context: PlaceContext): Promise<PlacedTrade> {
  const placement = await placementOf(ask, context);
  const { amount } = ask;
  const held = "base" in amount ? amount.base : await heldOf(ask, context);
  const amountInBase =
    "base" in amount ? amount.base : shareAmountBase(held ?? 0n, amount.percentBps);
  const terms = { ...placement, amountInBase };
  const swap = swapTradeOf(ask, terms, context);
  const refusal =
    placement.refusal ?? shareRefusal({ held, amountInBase, isShare: !("base" in amount) });
  return refusal === undefined ? { swap } : { swap, refusal };
}

/**
 * The trade a confirmed quote runs: its amount, what it buys and its place as the quote has them,
 * on the venues of its route. The wallet queue judges this trade again, never a new share or place.
 */
export function quotedTradeOf(ask: TradeAsk, quote: QuoteView, context: SwapContext): SwapTrade {
  const terms = {
    amountInBase: quote.amountIn.base,
    assetOut: quote.minOut.asset,
    venues: quote.route.map((leg) => leg.venue),
    ...(quote.place === undefined ? {} : { place: quote.place }),
  };
  return swapTradeOf({ ...ask, assetIn: quote.amountIn.asset }, terms, context);
}
