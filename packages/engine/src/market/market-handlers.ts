import {
  type AssetRef,
  type ChainRegistry,
  canonicalAsset,
  type MarketCandle,
  type MarketPool,
  type TrendingToken,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type {
  ArgsOf,
  CandleView,
  ProtocolErrorCode,
  ResultOf,
  ScanItem,
} from "@binference/protocol";
import { assetInfosOf } from "../money-path/asset-infos.js";
import type { EngineHandler } from "../operations/engine-call.js";
import type { MarketReadFailure } from "./market-answer.js";
import type { MarketReads } from "./ports.js";
import { priceScaleOf, scaledUsdMicros } from "./price-scale.js";

/** The handlers of `market/scan` and `market/chart` (protocol spec, section 7.3). */
export interface MarketHandlers {
  readonly "market/scan": EngineHandler<"market/scan">;
  readonly "market/chart": EngineHandler<"market/chart">;
}

/** The engine's market reads: pools, trending tokens and candles from the data sources. */
export interface MarketParts {
  /** What `market/scan` and `market/chart` read; they never price a trade. */
  readonly marketReads: MarketReads;
}

/** What the market handlers read: the market reads and the chain registry. */
export interface MarketHandlersOptions {
  readonly reads: MarketReads;
  readonly chains: ChainRegistry;
}

/** The items a scan answers unless the call asks for fewer or more. */
const defaultScanLimit = 20;
/** The candles a chart answers unless the call asks for fewer or more. */
const defaultChartLimit = 100;

const failureCodes: Readonly<Record<MarketReadFailure, ProtocolErrorCode>> = {
  no_data: "market.no_data",
  source_down: "market.source_down",
};

// The registry's canonical form of an asset, or the asset as the source wrote it.
function canonicalOf(chains: ChainRegistry, asset: AssetRef): AssetRef {
  const canonical = canonicalAsset(chains, asset);
  return canonical.ok ? canonical.value : asset;
}

// The figures of a token's pool a scan item carries, its price for 10^scale tokens.
function poolFiguresOf(pool: MarketPool): Partial<ScanItem> {
  const { priceUsd, liquidityUsdMicros, volume24hUsdMicros, change24hBps } = pool;
  const scale = priceUsd === undefined ? 0 : priceScaleOf([priceUsd]);
  return {
    ...(priceUsd === undefined ? {} : { priceUsdMicros: scaledUsdMicros(priceUsd, scale) }),
    ...(scale === 0 ? {} : { priceScale: scale }),
    ...(liquidityUsdMicros === undefined ? {} : { liquidityUsdMicros }),
    ...(volume24hUsdMicros === undefined ? {} : { volume24hUsdMicros }),
    ...(change24hBps === undefined ? {} : { change24hBps }),
  };
}

// A trending token as a scan item: the figures of its pool, and its active boosts.
function scanItemOf(chains: ChainRegistry, token: TrendingToken): ScanItem {
  const { pool, activeBoosts } = token;
  return {
    asset: canonicalOf(chains, token.asset),
    ...(pool === undefined ? {} : poolFiguresOf(pool)),
    ...(activeBoosts === undefined ? {} : { activeBoosts }),
  };
}

// A candle with its prices for 10^scale tokens, its volume in micro-dollars.
function candleViewOf(candle: MarketCandle, scale: number): CandleView {
  return {
    at: candle.atMs,
    openUsdMicros: scaledUsdMicros(candle.open, scale),
    highUsdMicros: scaledUsdMicros(candle.high, scale),
    lowUsdMicros: scaledUsdMicros(candle.low, scale),
    closeUsdMicros: scaledUsdMicros(candle.close, scale),
    volumeUsdMicros: candle.volumeUsdMicros,
  };
}

const failed = <T>(failure: MarketReadFailure): Result<T, ProtocolErrorCode> =>
  err(failureCodes[failure]);

// `market/scan`: the chain's trending tokens; launches wait for the launch feed.
async function scanOf(
  options: MarketHandlersOptions,
  args: ArgsOf<"market/scan">,
  signal: AbortSignal,
): Promise<Result<ResultOf<"market/scan">, ProtocolErrorCode>> {
  const { reads, chains } = options;
  if (!chains.get(args.chain).ok || (args.source === "trending" && args.filters !== undefined)) {
    return err("protocol.bad_args");
  }
  if (args.source === "launches") {
    return err("market.no_launch_feed");
  }
  const trending = await reads.trending(args.chain, { signal });
  if (!trending.ok) {
    return failed(trending.error);
  }
  const tokens = trending.value.items.slice(0, args.limit ?? defaultScanLimit);
  const items = tokens.map((token) => scanItemOf(chains, token));
  return ok({
    items,
    assets: assetInfosOf(
      chains,
      items.map((item) => item.asset),
    ),
  });
}

// `market/chart`: the token's candles, one price scale for them all.
async function chartOf(
  reads: MarketReads,
  args: ArgsOf<"market/chart">,
  signal: AbortSignal,
): Promise<Result<ResultOf<"market/chart">, ProtocolErrorCode>> {
  const request = {
    interval: args.interval,
    limit: args.limit ?? defaultChartLimit,
    ...(args.to === undefined ? {} : { beforeMs: args.to }),
  };
  const chart = await reads.chart(args.asset, request, { signal });
  if (!chart.ok) {
    return failed(chart.error);
  }
  const { items, source } = chart.value;
  const scale = priceScaleOf(
    items.flatMap((candle) => [candle.open, candle.high, candle.low, candle.close]),
  );
  return ok({
    asset: args.asset,
    interval: args.interval,
    candles: items.map((candle) => candleViewOf(candle, scale)),
    ...(scale === 0 ? {} : { priceScale: scale }),
    source,
  });
}

/**
 * Creates the market handlers. `market/scan` answers a chain's trending tokens from the market
 * reads, in their source's order, at most `limit` (20 unless given), each with its pool's figures
 * and its active boosts, and the registry's info of the tokens it lists; prices are scaled per
 * item (decision 0184). A chain the registry does not hold, or `filters` with `trending`, is
 * `protocol.bad_args`; `launches` is `market.no_launch_feed` while no launch feed runs.
 * `market/chart` answers a token's `limit` (100 unless given) newest candles before `to`, oldest
 * first, with one price scale for the chart and the source's name. A read with no answer is
 * `market.no_data`, one whose source was down `market.source_down`.
 */
export function createMarketHandlers(options: MarketHandlersOptions): MarketHandlers {
  return {
    "market/scan": async ({ args, signal }) => scanOf(options, args, signal),
    "market/chart": async ({ args, signal }) => chartOf(options.reads, args, signal),
  };
}
