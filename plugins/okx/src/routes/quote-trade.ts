import {
  BinferenceError,
  err,
  ok,
  type QuoteRequest,
  type Result,
  type VenueQuote,
} from "@binference/plugin-sdk";
import { aggregatorPairOf } from "@binference/plugin-sdk/evm";
import type { RouteQuery } from "../api/okx-api.js";
import type { OkxRoute } from "../api/route-answer.schema.js";
import type { VenueParts } from "../venue-parts.js";
import { hookedDexIds, hookedSourcesIn } from "./hooked-sources.js";
import { priceImpactOf } from "./price-impact.js";
import { routeRecordOf } from "./route-record.schema.js";

/** The trade as OKX's API names it; undefined on a chain or with an asset it does not trade. */
export function routeQueryOf(request: QuoteRequest, parts: VenueParts): RouteQuery | undefined {
  const pair = aggregatorPairOf(request, parts.setups);
  return pair === undefined
    ? undefined
    : {
        chainIndex: pair.on.chainIndex,
        tokenIn: pair.tokenIn,
        tokenOut: pair.tokenOut,
        amountIn: request.amountIn.base,
        excludedDexIds: [],
      };
}

/**
 * Checks that OKX routed the trade asked for: the same tokens and the exact input. Any other route
 * throws `okx.bad_route`.
 */
export function checkRoute(route: OkxRoute, query: RouteQuery): void {
  const isTrade =
    route.tokenIn === query.tokenIn &&
    route.tokenOut === query.tokenOut &&
    route.amountIn === query.amountIn;
  if (!isTrade) {
    throw new BinferenceError({
      code: "okx.bad_route",
      message: "OKX answered with a route for other tokens or another amount.",
    });
  }
}

async function findRoute(
  query: RouteQuery,
  parts: VenueParts,
  signal: AbortSignal,
): Promise<Result<OkxRoute, "no_route">> {
  const found = await parts.api.quote(query, signal);
  if (found.ok) {
    checkRoute(found.value, query);
  }
  return found;
}

function quoteOf(
  route: OkxRoute,
  request: QuoteRequest,
  excludedDexIds: readonly string[],
): VenueQuote {
  return {
    expectedOut: { asset: request.assetOut, base: route.amountOut },
    priceImpactBps: priceImpactOf(route.priceImpactPercent),
    route: routeRecordOf({ excludedDexIds, sources: route.sources }),
  };
}

/**
 * Quotes a trade on OKX. A route through a protocol whose pools run hooks (PancakeSwap Infinity,
 * Uniswap v4) is dropped, and OKX is asked once more without those protocols' DEX ids, read from
 * its liquidity list; a second such route, an asset OKX does not trade here or a pair it cannot
 * route is `no_route`. A route for another trade throws `okx.bad_route`.
 */
export async function quoteTrade(
  request: QuoteRequest,
  parts: VenueParts,
  signal: AbortSignal,
): Promise<Result<VenueQuote, "no_route">> {
  signal.throwIfAborted();
  const query = routeQueryOf(request, parts);
  if (query === undefined) {
    return err("no_route");
  }
  const first = await findRoute(query, parts, signal);
  if (!first.ok || hookedSourcesIn(first.value.sources).length === 0) {
    return first.ok ? ok(quoteOf(first.value, request, [])) : first;
  }
  const excludedDexIds = hookedDexIds(await parts.api.liquidity(query.chainIndex, signal));
  if (excludedDexIds.length === 0) {
    return err("no_route");
  }
  const second = await findRoute({ ...query, excludedDexIds }, parts, signal);
  return second.ok && hookedSourcesIn(second.value.sources).length === 0
    ? ok(quoteOf(second.value, request, excludedDexIds))
    : err("no_route");
}
