import type { CurveChain } from "@binference/plugin-sdk/evm";

/** What the Genius.fun venue is made from: the chains it trades on. */
export interface GeniusfunOptions {
  /**
   * Each chain with its coin, the quote tokens of the curves the venue trades besides the coin,
   * from the chain registry (on BNB Smart Chain, USDT and USDC), and the RPC failover through which
   * the venue reads Genius.fun's contracts by `eth_call`.
   */
  readonly chains: readonly CurveChain[];
}
