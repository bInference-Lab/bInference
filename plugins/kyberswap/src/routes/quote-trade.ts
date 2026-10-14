import {
  accountRefSchema,
  BinferenceError,
  bpsSchema,
  type ChainRef,
  err,
  ok,
  type PoolHookFee,
  type QuoteRequest,
  type Result,
  type VenueQuote,
} from "@binference/plugin-sdk";
import { aggregatorPairOf, parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import type { RouteQuery } from "../api/kyberswap-api.js";
import type { FoundRoute, RouteHop } from "../api/route-answer.schema.js";
import type { HookFee } from "../chain-setup.js";
import { contractOf, routerName } from "../kyberswap-contracts.js";
import type { VenueParts } from "../venue-parts.js";
import { unlistedHookSources } from "./hook-check.js";
import { priceImpactOf } from "./price-impact.js";

interface TradeQuery {
  readonly chain: ChainRef;
  readonly query: RouteQuery;
  readonly allowedHooks: ReadonlySet<Address>;
  readonly hookFees: ReadonlyMap<Address, HookFee>;
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

type AllowedHook = readonly [Address, HookFee];

// The whole trade, in basis points: no hooks keep more.
const wholeBps = 10_000;

// The allowed hooks of one pool and of the candidates nested in it, each with its fee.
function allowedIn(pools: readonly RouteHop[], fees: ReadonlyMap<Address, HookFee>): AllowedHook[] {
  return pools.flatMap((pool): AllowedHook[] => {
    const hook = pool.hookAddress === undefined ? undefined : parseEvmAddress(pool.hookAddress);
    const fee = hook?.ok === true ? fees.get(hook.value) : undefined;
    return hook?.ok === true && fee !== undefined ? [[hook.value, fee]] : [];
  });
}

// What one path's pools keep by maker: each pool counts the largest fee of it and its candidates,
// as the path might swap through any of them.
function pathFees(
  path: readonly (readonly RouteHop[])[],
  fees: ReadonlyMap<Address, HookFee>,
): ReadonlyMap<string, number> {
  const sums = new Map<string, number>();
  for (const pools of path) {
    const largest = new Map<string, number>();
    for (const [, fee] of allowedIn(pools, fees)) {
      largest.set(fee.maker, Math.max(largest.get(fee.maker) ?? 0, fee.feeBps));
    }
    for (const [maker, bps] of largest) {
      sums.set(maker, (sums.get(maker) ?? 0) + bps);
    }
  }
  return sums;
}

// What the allowed hooks on the route keep, by maker: the sum of their fees along the maker's
// costliest path, at most the whole trade, with every hook of the maker the route passes. A maker
// whose hooks keep nothing is left out.
function hookFeesOf(route: FoundRoute, trade: TradeQuery): readonly PoolHookFee[] {
  const allowed = route.paths.flat().flatMap((pools) => allowedIn(pools, trade.hookFees));
  const perPath = route.paths.map((path) => pathFees(path, trade.hookFees));
  const makers = [...new Set(allowed.map(([, fee]) => fee.maker))];
  return makers.flatMap((maker): PoolHookFee[] => {
    const costliest = Math.max(...perPath.map((sums) => sums.get(maker) ?? 0));
    const hooks = new Set(allowed.filter(([, fee]) => fee.maker === maker).map(([hook]) => hook));
    const feeBps = bpsSchema.parse(Math.min(costliest, wholeBps));
    const accounts = [...hooks].map((hook) => accountRefSchema.parse(`${trade.chain}:${hook}`));
    return feeBps === 0 ? [] : [{ maker, feeBps, hooks: accounts }];
  });
}

function quoteOf(route: FoundRoute, request: QuoteRequest, trade: TradeQuery): VenueQuote {
  const hookFees = hookFeesOf(route, trade);
  return {
    expectedOut: { asset: request.assetOut, base: route.amountOut },
    priceImpactBps: priceImpactOf(route.amountInUsd, route.amountOutUsd),
    ...(hookFees.length === 0 ? {} : { hookFees }),
    route: route.summary,
  };
}

// The trade as KyberSwap's API names it; undefined on a chain or with an asset it does not trade.
function queryOf(request: QuoteRequest, parts: VenueParts): TradeQuery | undefined {
  const pair = aggregatorPairOf(request, parts.setups);
  if (pair === undefined) {
    return undefined;
  }
  const { on, tokenIn, tokenOut } = pair;
  const query = { slug: on.slug, tokenIn, tokenOut, amountIn: request.amountIn.base };
  const { allowedHooks, hookFees } = on;
  return { chain: on.chain, query: { ...query, excludedSources: [] }, allowedHooks, hookFees };
}

/**
 * Quotes a trade on KyberSwap. A route through a pool whose hook is not on the chain's allowlist is
 * dropped, and KyberSwap is asked once more without those pools' DEX ids; a second route with an
 * unlisted hook, an asset KyberSwap does not trade here or a pair it cannot route is `no_route`.
 * A quote names what the allowed hooks its route passes keep, by who made their pools: the sum of
 * their fees along that maker's costliest path.
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
    return first.ok ? ok(quoteOf(first.value, request, trade)) : first;
  }
  const query = { ...trade.query, excludedSources: unlisted(first.value) };
  const second = await findRoute({ ...checked, query }, signal);
  return second.ok && unlisted(second.value).length === 0
    ? ok(quoteOf(second.value, request, trade))
    : err("no_route");
}
