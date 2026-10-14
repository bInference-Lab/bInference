import type { CurveChain } from "@binference/plugin-sdk/evm";

/** What the Flap venue is made from: the chains it trades on. */
export interface FlapOptions {
  /**
   * Each chain with its coin, the quote tokens of its curves besides the coin, each with 18
   * decimals, from the chain registry (on BNB Smart Chain, USDT and USD1), and the RPC failover
   * through which the venue reads Flap's Portal by `eth_call`.
   */
  readonly chains: readonly CurveChain[];
}
