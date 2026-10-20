import type { AccountRef, ChainRef, Http, Random, TxSimulator } from "@binference/plugin-sdk";
import type { CurveChain } from "@binference/plugin-sdk/evm";

/** One chain Flap launches tokens on, as the composition root gives it. */
export interface FlapLaunchChain {
  readonly chain: ChainRef;
  /** The chain's transaction simulator, on which a launch's quote runs its create call unsent. */
  readonly simulator: Pick<TxSimulator, "simulate">;
  /**
   * The implementation every Flap tax token on the chain is a proxy of, from the chain registry
   * (`flap`'s `tax-token-v3-implementation`): with the Portal and a salt, it gives a token's address
   * before its create call runs.
   */
  readonly taxTokenImplementation: AccountRef;
}

/** What Flap's launches are made from: its upload API, the salts' randomness and the chains. */
export interface FlapLaunchOptions {
  /** Reaches Flap's own API, which uploads and pins a launch's words and picture. */
  readonly http: Http;
  /** The random start of each salt search. */
  readonly random: Random;
  readonly chains: readonly FlapLaunchChain[];
}

/** What the Flap venue is made from: the chains it trades on, and what its launches need. */
export interface FlapOptions {
  /**
   * Each chain with its coin, the quote tokens of its curves besides the coin, each with 18
   * decimals, from the chain registry (on BNB Smart Chain, USDT and USD1), and the RPC failover
   * through which the venue reads Flap's Portal by `eth_call`.
   */
  readonly chains: readonly CurveChain[];
  /** What launches need; absent, the venue launches no token. */
  readonly launches?: FlapLaunchOptions;
}
