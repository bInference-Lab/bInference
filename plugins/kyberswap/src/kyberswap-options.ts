import type { AssetRef, ChainRef, Http } from "@binference/plugin-sdk";

/** One chain the KyberSwap venue trades on, as the composition root reads it from the registry. */
export interface KyberswapChain {
  readonly chain: ChainRef;
  /** The chain's own coin. KyberSwap's API and router write it as `0xEeee…EEeE`. */
  readonly nativeAsset: AssetRef;
  /**
   * The pool hooks a route may pass through on this chain, as EVM addresses. A route through a
   * PancakeSwap Infinity or Uniswap v4 pool whose hook is not listed here is dropped; a pool with no
   * hook always passes.
   */
  readonly allowedHooks: readonly string[];
}

/** What the KyberSwap venue is made from. */
export interface KyberswapOptions {
  /** Reaches KyberSwap's public aggregator API. */
  readonly http: Http;
  /**
   * Names binference to KyberSwap: the `x-client-id` header of every call and the `source` of
   * every build. KyberSwap gives a named client a higher rate limit, with no key.
   */
  readonly clientId: string;
  readonly chains: readonly KyberswapChain[];
}
