import type { AssetRef, Bps, ChainRef, Http } from "@binference/plugin-sdk";

/** A pool hook a route may pass through, and the share of each swap through its pools it keeps. */
export interface KyberswapHook {
  /** The hook's contract, as an EVM address. */
  readonly address: string;
  /** The share it keeps, as the chain's hook allowlist states it. */
  readonly feeBps: Bps;
}

/** One chain the KyberSwap venue trades on, as the composition root reads it from the registry. */
export interface KyberswapChain {
  readonly chain: ChainRef;
  /** The chain's own coin. KyberSwap's API and router write it as `0xEeee…EEeE`. */
  readonly nativeAsset: AssetRef;
  /**
   * The pool hooks a route may pass through on this chain, each with the fee it keeps. A route
   * through a PancakeSwap Infinity or Uniswap v4 pool whose hook is not listed here is dropped; a
   * pool with no hook always passes. A quote names the largest fee of the hooks its route passes.
   */
  readonly allowedHooks: readonly KyberswapHook[];
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
