import type { AssetRef, ChainRef, MarketPool, TrendingToken } from "@binference/chain";
import type { Result } from "@binference/core";
import type { MarketAnswer, MarketReadFailure } from "./market-answer.js";

/**
 * The market reads the agent and the owner ask for (spec 1, section 7.3): a token's pools and a
 * chain's trending tokens, from the market data sources. Each answer names its source; none
 * prices a trade. Adapters: the sources asked in order under a timeout, and a market-data service
 * that reads once for every agent.
 */
export interface MarketReads {
  /** The token's pools, deepest first. Rejects with the signal's reason once it aborts. */
  pools(
    asset: AssetRef,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<MarketAnswer<MarketPool>, MarketReadFailure>>;
  /** The chain's trending tokens, in the source's order. Rejects as `pools` does. */
  trending(
    chain: ChainRef,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<MarketAnswer<TrendingToken>, MarketReadFailure>>;
}
