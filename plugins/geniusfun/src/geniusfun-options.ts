import type { ChainRef, Random, TxSimulator } from "@binference/plugin-sdk";
import type { CurveChain } from "@binference/plugin-sdk/evm";

/** One chain Genius.fun launches tokens on, as the composition root gives it. */
export interface GeniusfunLaunchChain {
  readonly chain: ChainRef;
  /**
   * The chain's transaction simulator, on which a launch's quote and build run its create call
   * unsent: the quote for the first buy's output, the build for the token's address.
   */
  readonly simulator: Pick<TxSimulator, "simulate">;
}

/** What Genius.fun's launches are made from: the salts' randomness and the chains. */
export interface GeniusfunLaunchOptions {
  /** The random salt of each launch. */
  readonly random: Random;
  readonly chains: readonly GeniusfunLaunchChain[];
}

/** What the Genius.fun venue is made from: the chains it trades on, and what its launches need. */
export interface GeniusfunOptions {
  /**
   * Each chain with its coin, the quote tokens of the curves the venue trades besides the coin,
   * from the chain registry (on BNB Smart Chain, USDT and USDC), and the RPC failover through which
   * the venue reads Genius.fun's contracts by `eth_call`.
   */
  readonly chains: readonly CurveChain[];
  /** What launches need; absent, the venue launches no token. */
  readonly launches?: GeniusfunLaunchOptions;
}
