import type { Ratio } from "@binference/core";
import type { AssetRef } from "../caip/asset-ref.js";

/**
 * One trading pool of a token, as a market data source reports it. The figures are the source's,
 * never read on chain: they inform the agent and cross-check the watchers, and never price a trade.
 */
export interface MarketPool {
  /** The source's id of the exchange the pool belongs to, such as `pancakeswap`. */
  readonly dex: string;
  /**
   * The pool as the source names it on its chain: its contract's address, or its id where the
   * exchange keeps every pool in one contract.
   */
  readonly pool: string;
  /** The token the pool prices. */
  readonly base: AssetRef;
  /** The token the pool prices it in. */
  readonly quote: AssetRef;
  /** USD for one whole base token, exactly as the source wrote it. Absent when unpriced. */
  readonly priceUsd?: Ratio;
  /** The pool's liquidity in micro-dollars, rounded down. */
  readonly liquidityUsdMicros?: bigint;
  /** What the pool traded in the last 24 hours, in micro-dollars, rounded down. */
  readonly volume24hUsdMicros?: bigint;
  /** The base token's price change over 24 hours in signed basis points, toward zero. */
  readonly change24hBps?: number;
  /** When the pool was created, in epoch milliseconds. */
  readonly createdAtMs?: number;
}

/** One token of a source's trending list, in the source's order. */
export interface TrendingToken {
  readonly asset: AssetRef;
  /** The token's deepest pool the source knows of, when it knows one. */
  readonly pool?: MarketPool;
  /**
   * Paid promotion behind the token's place: the boosts bought for it that are active now. A
   * source that ranks without paid promotion leaves it out.
   */
  readonly activeBoosts?: number;
}
