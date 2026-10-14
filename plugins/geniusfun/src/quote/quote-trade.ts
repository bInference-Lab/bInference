import {
  accountRefParts,
  type Bps,
  bpsSchema,
  err,
  ok,
  type QuoteRequest,
  type Result,
  type VenueQuote,
} from "@binference/plugin-sdk";
import { type CurveSide, curveSideOf } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import { launchPhase, type LaunchRecord } from "../contracts/genius-calls.js";
import { type GeniusRead, unreadable } from "../contracts/read-genius.js";
import { buyOut, sellOut } from "../curve/curve-math.js";
import { type BuyState, readBuyState } from "../curve/curve-state.js";
import { addressOf, curveName, factoriesOf } from "../geniusfun-contracts.js";
import { findLaunch } from "../launch/find-launch.js";
import { curveKeyOf, type VenueParts } from "../venue-parts.js";
import { curveImpactBps } from "./price-impact.js";

/**
 * Why the venue quotes no route: not a buy or sale between a token and a quote asset it serves; a
 * token no listed stack launched, or one a stack the registry does not list says it launched; a
 * launch graduating (its curve ready to graduate, or swept, before its pool exists); a token off
 * its curve (with its pool, or rescued); a curve that trades against another asset than the
 * trade's; a buy that would take the curve's last tokens; or a trade that would get nothing.
 */
export type QuoteMiss =
  | "no_curve_trade"
  | "not_launched"
  | "unknown_stack"
  | "graduating"
  | "not_on_curve"
  | "other_pair"
  | "fills_curve"
  | "nothing_out";

/** The trade, the curve of its token's launch, and that curve's state for the trade's wallet. */
interface CurveTrade {
  readonly side: CurveSide;
  readonly launch: LaunchRecord;
  readonly state: BuyState;
}

function bpsOf(value: bigint): Bps {
  const parsed = bpsSchema.safeParse(Number(value));
  if (value > 10_000n || !parsed.success) {
    throw unreadable("a curve reports a share above the whole trade.");
  }
  return parsed.data;
}

/** What a trade gets from the curve: its output, and the taxes it pays, which the quote names. */
interface TradeOutcome {
  readonly amountOut: bigint;
  readonly taxPaid: bigint;
  /** The snipe tax the curve charges a buy, after its bound; none on a sale. */
  readonly snipeTaxBps: bigint;
}

function outcomeOf(trade: CurveTrade, amountIn: bigint): TradeOutcome | undefined {
  const { side, launch, state } = trade;
  const terms = { ...state, creatorTaxBps: launch.creatorTaxBps };
  if (side.side === "sell") {
    const sold = sellOut(terms, amountIn);
    return sold === undefined
      ? undefined
      : { amountOut: sold.quoteOut, taxPaid: sold.taxPaid, snipeTaxBps: 0n };
  }
  const bought = buyOut(terms, amountIn);
  return bought === undefined
    ? undefined
    : { amountOut: bought.tokensOut, taxPaid: bought.taxPaid, snipeTaxBps: bought.snipeTaxBps };
}

// The quote of a trade the curve takes, with the taxes it names apart; no route for nothing out,
// or for a buy that would take the curve's last tokens, which the curve fills only in part.
function quoteOf(trade: CurveTrade, request: QuoteRequest): Result<VenueQuote, QuoteMiss> {
  const amountIn = request.amountIn.base;
  const outcome = outcomeOf(trade, amountIn);
  if (outcome === undefined || outcome.amountOut === 0n) {
    return err("nothing_out");
  }
  const { amountOut, taxPaid, snipeTaxBps } = outcome;
  if (trade.side.side === "buy" && amountOut >= trade.state.sellable) {
    return err("fills_curve");
  }
  const taxBps = bpsOf(trade.launch.creatorTaxBps + snipeTaxBps);
  const impact = { side: trade.side.side, amountIn, amountOut, taxPaid, reserves: trade.state };
  return ok({
    expectedOut: { asset: request.assetOut, base: amountOut },
    priceImpactBps: curveImpactBps(impact),
    ...(taxBps > 0 ? { taxBps } : {}),
    ...(snipeTaxBps > 0n ? { snipeTaxBps: bpsOf(snipeTaxBps) } : {}),
  });
}

// The token's launch and its curve's state, read at once on the curve the host gave.
async function curveTradeOf(
  read: GeniusRead,
  asked: { readonly request: QuoteRequest; readonly side: CurveSide; readonly curve: Address },
): Promise<Result<CurveTrade, QuoteMiss>> {
  const { request, side, curve } = asked;
  const wallet = addressOf(request.wallet);
  const [finding, state] = await Promise.all([
    findLaunch(read, factoriesOf(request.contracts), side.token),
    readBuyState(read, curve, wallet),
  ]);
  if (finding.kind !== "launched") {
    return err(finding.kind);
  }
  const { launch } = finding;
  if (launch.curve !== curve) {
    throw unreadable("the curve the host gave is not the token's own.");
  }
  if (launch.phase === launchPhase.poolCreated || launch.phase === launchPhase.rescued) {
    return err("not_on_curve");
  }
  if (launch.phase !== launchPhase.notGraduated || state.sellable === 0n) {
    return err("graduating");
  }
  return launch.pairToken === side.quote ? ok({ side, launch, state }) : err("other_pair");
}

/**
 * Quotes a trade on a Genius.fun curve with the reason it may not: the token's launch read from
 * every live stack's factory, and its curve's reserves, fee, sellable tokens and the snipe tax a
 * buy for the wallet pays now, all at the latest block on the curve the host gave (decision 0212).
 * The output is the curve's own arithmetic to the wei. The quote names the creator tax and the
 * snipe tax the curve takes as its tax, and the snipe tax apart (decision 0213). A request with no
 * curve, because the curve read named none, is `not_on_curve`. A curve that is not the token's
 * own, or a contract that cannot be read, throws.
 */
export async function curveQuote(
  request: QuoteRequest,
  parts: VenueParts,
  signal: AbortSignal,
): Promise<Result<VenueQuote, QuoteMiss>> {
  signal.throwIfAborted();
  const setup = parts.setups.get(accountRefParts(request.wallet).chain);
  const side = setup === undefined ? undefined : curveSideOf(request, setup);
  if (setup === undefined || side === undefined) {
    return err("no_curve_trade");
  }
  const curveAccount = request.contracts[curveName];
  if (curveAccount === undefined) {
    return err("not_on_curve");
  }
  const read = { rpc: setup.rpc, signal };
  const trade = await curveTradeOf(read, { request, side, curve: addressOf(curveAccount) });
  if (!trade.ok) {
    return trade;
  }
  const key = curveKeyOf(setup.chain, trade.value.launch.curve);
  parts.launches.set(key, { token: side.token, pairToken: side.quote });
  return quoteOf(trade.value, request);
}

/** The port's quote: {@link curveQuote} with every reason it gives as `no_route`. */
export async function quoteTrade(
  request: QuoteRequest,
  parts: VenueParts,
  signal: AbortSignal,
): Promise<Result<VenueQuote, "no_route">> {
  const quote = await curveQuote(request, parts, signal);
  return quote.ok ? quote : err("no_route");
}
