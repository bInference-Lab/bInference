import {
  accountRefParts,
  BinferenceError,
  err,
  ok,
  type QuoteRequest,
  type Result,
  type VenueQuote,
} from "@binference/plugin-sdk";
import type { Address } from "viem";
import type { RouteQuery } from "../api/kyberswap-api.js";
import type { FoundRoute } from "../api/route-answer.schema.js";
import { contractOf, routerName } from "../kyberswap-contracts.js";
import { tokenOf } from "../router/token-address.js";
import type { VenueParts } from "../venue-parts.js";
import { unlistedHookSources } from "./hook-check.js";
import { priceImpactOf } from "./price-impact.js";

interface TradeQuery {
  readonly query: RouteQuery;
  readonly allowedHooks: ReadonlySet<Address>;
}

interface CheckedQuery {
  readonly parts: VenueParts;
  readonly query: RouteQuery;
  readonly router: Address;
}

function mismatch(problem: string): BinferenceError {
  return new BinferenceError({
    code: "kyberswap.bad_route",
    message: `KyberSwap answered with a route it cannot be used for: ${problem}`,
  });
}

// The answer must route the trade asked for, through the registry's router, with no extra fee.
async function findRoute(
  { parts, query, router }: CheckedQuery,
  signal: AbortSignal,
): Promise<Result<FoundRoute, "no_route">> {
  const found = await parts.api.findRoute(query, signal);
  if (!found.ok) {
    return found;
  }
  const route = found.value;
  const isTrade =
    route.tokenIn === query.tokenIn &&
    route.tokenOut === query.tokenOut &&
    route.amountIn === query.amountIn;
  if (!isTrade) {
    throw mismatch("it trades other tokens or another amount.");
  }
  if (route.routerAddress !== router || route.chargesFee) {
    throw mismatch("it goes through another router or takes a fee.");
  }
  return found;
}

function quoteOf(route: FoundRoute, request: QuoteRequest): VenueQuote {
  return {
    expectedOut: { asset: request.assetOut, base: route.amountOut },
    priceImpactBps: priceImpactOf(route.amountInUsd, route.amountOutUsd),
    route: route.summary,
  };
}

// The trade as KyberSwap's API names it; undefined on a chain or with an asset it does not trade.
function queryOf(request: QuoteRequest, parts: VenueParts): TradeQuery | undefined {
  const setup = parts.setups.get(accountRefParts(request.wallet).chain);
  const tokenIn = setup === undefined ? undefined : tokenOf(request.amountIn.asset, setup);
  const tokenOut = setup === undefined ? undefined : tokenOf(request.assetOut, setup);
  if (setup === undefined || tokenIn === undefined || tokenOut === undefined) {
    return undefined;
  }
  const query = { slug: setup.slug, tokenIn, tokenOut, amountIn: request.amountIn.base };
  return { query: { ...query, excludedSources: [] }, allowedHooks: setup.allowedHooks };
}

/**
 * Quotes a trade on KyberSwap. A route through a pool whose hook is not on the chain's allowlist is
 * dropped, and KyberSwap is asked once more without those pools' DEX ids; a second route with an
 * unlisted hook, an asset KyberSwap does not trade here or a pair it cannot route is `no_route`.
 * An answer for another trade, router or fee throws `kyberswap.bad_route`.
 */
export async function quoteTrade(
  request: QuoteRequest,
  parts: VenueParts,
  signal: AbortSignal,
): Promise<Result<VenueQuote, "no_route">> {
  signal.throwIfAborted();
  const trade = queryOf(request, parts);
  if (trade === undefined) {
    return err("no_route");
  }
  const checked = { parts, router: contractOf(request, routerName) };
  const unlisted = (route: FoundRoute): readonly string[] =>
    unlistedHookSources(route.hops, trade.allowedHooks);
  const first = await findRoute({ ...checked, query: trade.query }, signal);
  if (!first.ok || unlisted(first.value).length === 0) {
    return first.ok ? ok(quoteOf(first.value, request)) : first;
  }
  const query = { ...trade.query, excludedSources: unlisted(first.value) };
  const second = await findRoute({ ...checked, query }, signal);
  return second.ok && unlisted(second.value).length === 0
    ? ok(quoteOf(second.value, request))
    : err("no_route");
}
