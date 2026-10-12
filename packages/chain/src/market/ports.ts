import type { Result } from "@binference/core";
import type { AssetRef } from "../caip/asset-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { MarketPool, TrendingToken } from "./market-pool.js";

/**
 * A market data service the agent reads (ARCHITECTURE.md section 14, the `data` plugin kind), such
 * as DEX Screener: a token's pools and the trending tokens of a chain. It reads; it never moves
 * funds, and its figures never price a trade. Adapters: the `dexscreener` plugin.
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
}
