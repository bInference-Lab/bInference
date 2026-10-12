import type { Ratio, Result } from "@binference/core";
import type { AssetRef } from "../caip/asset-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { CandleRequest, MarketCandle } from "./market-candle.js";
import type { MarketPool, TrendingToken } from "./market-pool.js";

/**
 * A market data service the agent reads (ARCHITECTURE.md section 14, the `data` plugin kind), such
 * as DEX Screener: a token's pools and the trending tokens of a chain, and, where the service
 * publishes them, a token's candles and prices. It reads; it never moves funds, and its figures
 * never price a trade. Adapters: the `dexscreener` and `geckoterminal` plugins.
 */
export interface MarketDataSource {
  /** The source's id, which every answer names, such as `dexscreener`. */
  readonly id: string;
  /**
   * The token's pools, deepest first; none when the source knows no pool of it. A chain the
   * source does not serve is `not_covered`. A service that is down, refuses the request or
   * answers outside its documented shape rejects with a `BinferenceError`, and with the signal's
   * reason once the signal aborts.
   */
  pools(
    asset: AssetRef,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<readonly MarketPool[], "not_covered">>;
  /**
   * The chain's trending tokens, in the source's order. A chain the source does not serve is
   * `not_covered`; it rejects as {@link MarketDataSource.pools} does.
   */
  trending(
    chain: ChainRef,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<readonly TrendingToken[], "not_covered">>;
  /**
   * The token's candles in USD, oldest first, from the pool the source charts it on: at most
   * `request.limit`, each starting before `request.beforeMs` when given. None when the source
   * knows no pool of the token. A chain the source does not serve is `not_covered`; it rejects as
   * {@link MarketDataSource.pools} does. A source without candles has none, and is never asked.
   */
  readonly candles?: (
    asset: AssetRef,
    request: CandleRequest,
    options: { readonly signal: AbortSignal },
  ) => Promise<Result<readonly MarketCandle[], "not_covered">>;
  /**
   * The USD price of one whole token of each asset on the chain, exactly as the source wrote it,
   * for the price watcher to cross-check its own readings against; an asset the source prices
   * not, or on another chain, is left out. A chain the source does not serve is `not_covered`; it
   * rejects as {@link MarketDataSource.pools} does. A source without prices has none.
   */
  readonly prices?: (
    chain: ChainRef,
    assets: readonly AssetRef[],
    options: { readonly signal: AbortSignal },
  ) => Promise<Result<ReadonlyMap<AssetRef, Ratio>, "not_covered">>;
}
