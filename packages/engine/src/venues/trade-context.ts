import {
  accountRefParts,
  assetRefParts,
  type ChainRegistry,
  type QuoteRequest,
  type RegisteredChain,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import { frozenAmount } from "./host-terms.js";
import type { HostedVenue } from "./hosted-venue.js";
import { contractsWithLaunch, type LaunchContracts } from "./launch-contracts.js";
import type { VenueFailure, VenueTrade } from "./venue-host.js";

/** The trade's venue, chain and contracts, and the request the venue quotes. */
export interface TradeContext {
  readonly trade: VenueTrade;
  readonly hosted: HostedVenue;
  readonly chain: RegisteredChain;
  readonly request: QuoteRequest;
}

/**
 * The trade's context on its venue; a trade the host cannot run there is `venue_down` for an
 * unknown venue, and `no_route` for a chain or pair it does not serve.
 */
export function tradeContextOf(
  trade: VenueTrade,
  venues: ReadonlyMap<string, HostedVenue>,
  chains: ChainRegistry,
): Result<TradeContext, VenueFailure> {
  const hosted = venues.get(trade.venue);
  if (hosted === undefined) {
    return err("venue_down");
  }
  const chainRef = accountRefParts(trade.wallet).chain;
  const chain = chains.get(chainRef);
  const contracts = hosted.contracts.get(chainRef);
  const assets = [trade.amountIn.asset, trade.assetOut];
  const isPair = assets.every((asset) => assetRefParts(asset).chain === chainRef);
  if (!chain.ok || contracts === undefined || !isPair || trade.amountIn.asset === trade.assetOut) {
    return err("no_route");
  }
  const request: QuoteRequest = Object.freeze({
    wallet: trade.wallet,
    amountIn: frozenAmount(trade.amountIn),
    assetOut: trade.assetOut,
    contracts,
  });
  return ok({ trade, hosted, chain: chain.value, request });
}

/**
 * The trade with a launch's contracts in its request, or `undefined` when the launch names a
 * contract the venue does not declare as a launch's on the trade's chain.
 */
export function withLaunch(
  context: TradeContext,
  launch: LaunchContracts | undefined,
): TradeContext | undefined {
  const names = context.hosted.launchNames.get(context.chain.ref);
  const contracts = contractsWithLaunch(context.request.contracts, launch, names);
  return contracts === undefined
    ? undefined
    : { ...context, request: Object.freeze({ ...context.request, contracts }) };
}
