import {
  type AssetRef,
  assetRefParts,
  type CandleRequest,
  type ChainRef,
  type Clock,
  defineData,
  err,
  type Http,
  type MarketCandle,
  type MarketDataSource,
  type MarketPool,
  ok,
  type Ratio,
  type Result,
  type TrendingToken,
} from "@binference/plugin-sdk";
import { ratioOf } from "@binference/plugin-sdk/data";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import { createGeckoterminalApi, type GeckoterminalApi } from "./api/geckoterminal-api.js";
import { frameOf } from "./candle-frames.js";
import { type ChartPools, createChartPools } from "./chart-pools.js";
import {
  badAnswer,
  byDepth,
  candleOf,
  marketPoolOf,
  type PoolPlace,
  tokenOn,
} from "./gecko-figures.js";

/** What the GeckoTerminal source is made from. */
export interface GeckoterminalOptions {
  /** Reaches GeckoTerminal's public API, which answers without a key. */
  readonly http: Http;
  /** Paces the requests under GeckoTerminal's published limit, and dates each chart's pool. */
  readonly clock: Clock;
  /**
   * The longest a read waits for its turn under the limit, a 429's pause included, before it
   * fails as rate limited. One minute, the limit's window, unless given.
   */
  readonly maxWaitMs?: number;
}

// The chains the source serves, by their CAIP-2 id: GeckoTerminal's network id for each.
const networks: ReadonlyMap<string, string> = new Map([["eip155:56", "bsc"]]);
const defaultMaxWaitMs = 60_000;
// A token's chart pool holds for ten minutes, for at most 256 tokens.
const chartPoolTtlMs = 600_000;
const maxChartPools = 256;

/** A token the source can read: its chain's network and its address, checksummed. */
interface Covered {
  readonly place: PoolPlace;
  readonly token: AssetRef;
  readonly address: string;
}

// The network and address of an ERC-20 token on a chain the source serves; else none.
function coveredOf(asset: AssetRef): Covered | undefined {
  const { chain, assetNamespace, assetReference } = assetRefParts(asset);
  const network = networks.get(chain);
  const address = parseEvmAddress(assetReference);
  if (network === undefined || assetNamespace !== "erc20" || !address.ok) {
    return undefined;
  }
  return {
    place: { chain, network },
    token: tokenOn(chain, address.value),
    address: address.value,
  };
}

/** The reads the source makes, over the API and its memo of chart pools. */
interface Reads {
  readonly api: GeckoterminalApi;
  readonly clock: Clock;
  readonly chartPools: ChartPools;
}

// The token's pools, deepest first, each pool of the token asked about.
async function poolsOf(
  reads: Reads,
  covered: Covered,
  signal: AbortSignal,
): Promise<readonly MarketPool[]> {
  const { network } = covered.place;
  const answer = await reads.api.tokenPools(network, covered.address, signal);
  const pools = answer.map((pool) => marketPoolOf(pool, covered.place));
  return byDepth(
    pools.filter((pool) => pool.base === covered.token || pool.quote === covered.token),
  );
}

// The pool the token's chart is read from: its deepest, picked again every ten minutes.
async function chartPoolOf(
  reads: Reads,
  covered: Covered,
  signal: AbortSignal,
): Promise<string | undefined> {
  const kept = reads.chartPools.get(covered.token, reads.clock.now());
  if (kept !== undefined) {
    return kept;
  }
  const [deepest] = await poolsOf(reads, covered, signal);
  if (deepest !== undefined) {
    reads.chartPools.set(covered.token, deepest.pool, reads.clock.now());
  }
  return deepest?.pool;
}

// The newest candles before the request's time, oldest first, each start once.
function candlesIn(rows: readonly MarketCandle[], request: CandleRequest): readonly MarketCandle[] {
  const starts = new Map(rows.map((candle) => [candle.atMs, candle]));
  const sorted = [...starts.values()]
    .filter((candle) => request.beforeMs === undefined || candle.atMs < request.beforeMs)
    .toSorted((left, right) => left.atMs - right.atMs);
  return sorted.slice(Math.max(sorted.length - request.limit, 0));
}

// The token's candles from its chart pool, oldest first; none when it has no pool.
async function candlesOf(
  reads: Reads,
  asked: { readonly covered: Covered; readonly request: CandleRequest },
  signal: AbortSignal,
): Promise<readonly MarketCandle[]> {
  const { covered, request } = asked;
  const pool = await chartPoolOf(reads, covered, signal);
  if (pool === undefined) {
    return [];
  }
  const before =
    request.beforeMs === undefined ? {} : { beforeTimestamp: Math.ceil(request.beforeMs / 1_000) };
  const query = {
    network: covered.place.network,
    pool,
    ...frameOf(request.interval),
    limit: request.limit,
    token: covered.address,
    ...before,
  };
  const answer = await reads.api.ohlcv(query, signal);
  const base = answer.baseAddress?.toLowerCase() ?? covered.address.toLowerCase();
  if (base !== covered.address.toLowerCase()) {
    throw badAnswer("the candles price another token than the one asked.");
  }
  return candlesIn(answer.rows.map(candleOf), request);
}

// The chain's trending tokens: each trending pool's base token once, in GeckoTerminal's order.
async function trendingOf(
  reads: Reads,
  place: PoolPlace,
  signal: AbortSignal,
): Promise<readonly TrendingToken[]> {
  const pools = (await reads.api.trendingPools(place.network, signal)).map((pool) =>
    marketPoolOf(pool, place),
  );
  // A token's first trending pool names it; a later pool of the same token adds nothing.
  const tokens = new Map<AssetRef, TrendingToken>();
  for (const pool of pools) {
    tokens.set(pool.base, tokens.get(pool.base) ?? { asset: pool.base, pool });
  }
  return [...tokens.values()];
}

// The USD price of each token of the chain GeckoTerminal prices, exactly.
async function pricesOf(
  reads: Reads,
  covered: readonly Covered[],
  signal: AbortSignal,
): Promise<ReadonlyMap<AssetRef, Ratio>> {
  const [first] = covered;
  if (first === undefined) {
    return new Map();
  }
  const addresses = [...new Set(covered.map((each) => each.address))];
  const answer = await reads.api.tokenPrices(first.place.network, addresses, signal);
  return new Map(
    covered.flatMap((each) => {
      const price = ratioOf(answer.get(each.address.toLowerCase()));
      return price === undefined ? [] : [[each.token, price] as const];
    }),
  );
}

// Answers `not_covered` for a token on a chain the source does not serve, else reads it.
async function forCovered<T>(
  asset: AssetRef,
  signal: AbortSignal,
  read: (covered: Covered) => Promise<T>,
): Promise<Result<T, "not_covered">> {
  signal.throwIfAborted();
  const covered = coveredOf(asset);
  return covered === undefined ? err("not_covered") : ok(await read(covered));
}

/**
 * Creates the `geckoterminal` data source over GeckoTerminal's public API, keyless, on BNB Smart
 * Chain. A token's pools come from its top pools, deepest first. Its candles come from its
 * deepest pool's OHLCV in USD for the token itself, every interval of the chart with the empty
 * ones filled, oldest first. The trending tokens are the base tokens of GeckoTerminal's trending
 * pools, in its order, and the prices those of its token price endpoint, 30 a request. Another
 * chain is `not_covered`. Figures stay exact: numbers are read from the answer's own text.
 */
export function createGeckoterminalSource(options: GeckoterminalOptions): MarketDataSource {
  const api = createGeckoterminalApi({
    http: options.http,
    clock: options.clock,
    maxWaitMs: options.maxWaitMs ?? defaultMaxWaitMs,
  });
  const chartPools = createChartPools({ ttlMs: chartPoolTtlMs, maxEntries: maxChartPools });
  const reads: Reads = { api, clock: options.clock, chartPools };
  return defineData({
    id: "geckoterminal",
    pools: async (asset, { signal }) =>
      forCovered(asset, signal, async (covered) => poolsOf(reads, covered, signal)),
    candles: async (asset, request, { signal }) =>
      forCovered(asset, signal, async (covered) => candlesOf(reads, { covered, request }, signal)),
    async trending(chain, { signal }) {
      signal.throwIfAborted();
      const network = networks.get(chain);
      return network === undefined
        ? err("not_covered")
        : ok(await trendingOf(reads, { chain, network }, signal));
    },
    async prices(chain: ChainRef, assets, { signal }) {
      signal.throwIfAborted();
      if (!networks.has(chain)) {
        return err("not_covered");
      }
      const covered = assets.flatMap((asset) => {
        const each = coveredOf(asset);
        return each?.place.chain === chain ? [each] : [];
      });
      return ok(await pricesOf(reads, covered, signal));
    },
  });
}
