import type { AssetRef, ChainRef } from "@binference/plugin-sdk";
import type { RpcFailover } from "@binference/plugin-sdk/evm";

/** One chain the Flap venue trades on. */
export interface FlapChain {
  readonly chain: ChainRef;
  /** The chain's own coin, which a curve may trade against. */
  readonly nativeAsset: AssetRef;
  /**
   * The tokens besides the coin a curve may trade against here, each with 18 decimals, taken from
   * the chain registry: on BNB Smart Chain, USDT and USD1. A curve that trades against any other
   * token is still Flap's, but the venue quotes none of its trades.
   */
  readonly quoteTokens: readonly AssetRef[];
  /** The chain's RPC failover, through which the venue reads Flap's Portal by `eth_call`. */
  readonly rpc: RpcFailover;
}

/** What the Flap venue is made from: the chains it trades on. */
export interface FlapOptions {
  readonly chains: readonly FlapChain[];
}
