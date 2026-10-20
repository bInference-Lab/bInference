import type { AssetRef, ChainRef } from "@binference/plugin-sdk";

/** One chain Brew launches on, as the composition root gives it from the chain registry. */
export interface BrewChain {
  readonly chain: ChainRef;
  /** The chain's own coin. */
  readonly nativeAsset: AssetRef;
  /**
   * The chain's wrapped coin, which a Brew pool against the coin holds in its place, as Brew's
   * docs say of BNB: a launch against it trades against the coin.
   */
  readonly wrappedNative: AssetRef;
}

/** What the `brew` venue is made from: the chains it reads Brew's launches on. */
export interface BrewOptions {
  readonly chains: readonly BrewChain[];
}
