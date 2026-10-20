import type { AssetRef, ChainRef, Random, TxSimulator } from "@binference/plugin-sdk";
import type { RpcFailover } from "@binference/plugin-sdk/evm";

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

/** An asset a Brew token may launch against, with its decimals and its fixed start, if any. */
export interface BrewPair {
  /** The chain's coin, or a registry token of the chain other than its wrapped coin. */
  readonly asset: AssetRef;
  readonly decimals: number;
  /**
   * The market cap a token starts at against this pair when the owner sets none, in its base
   * units; absent, the start is $5,000 at binference's price of the pair (decision 0283).
   */
  readonly startBase?: bigint;
}

/** One chain Brew launches tokens on: its RPC failover, its simulator and its pairs. */
export interface BrewLaunchChain {
  readonly chain: ChainRef;
  /** The chain's RPC failover, through which a launch reads BrewFactory by `eth_call`. */
  readonly rpc: RpcFailover;
  /** The chain's transaction simulator, on which a quote runs the create call unsent. */
  readonly simulator: Pick<TxSimulator, "simulate">;
  readonly pairs: readonly BrewPair[];
}

/** What Brew's launches are made from: the salts' randomness and the chains. */
export interface BrewLaunchOptions {
  readonly random: Random;
  readonly chains: readonly BrewLaunchChain[];
}

/** What the `brew` venue is made from: the chains it serves, and what its launches need. */
export interface BrewOptions {
  readonly chains: readonly BrewChain[];
  /** What launches need; absent, the venue launches no token. */
  readonly launches?: BrewLaunchOptions;
}
