import type { AssetRef, ChainRef, Http } from "@binference/plugin-sdk";

/**
 * A route Across serves, as the registry lists it (decision 0301): the token that leaves the
 * source chain and the token that arrives on the destination chain, which may be wrapped ETH for
 * ETH. The bridge quotes no other pair.
 */
export interface AcrossRoute {
  readonly leaves: AssetRef;
  readonly arrives: AssetRef;
  /** Each token's decimals, as the registry lists them; Across's answer must name the same. */
  readonly decimals: { readonly leaves: number; readonly arrives: number };
  /**
   * The destination's coin when `arrives` is its wrapped coin, such as ETH for WETH: Across's Swap
   * API is asked for the coin, since asked for the wrapped token it pays a handler contract with a
   * message instead. The deposit still names the wrapped token, which a fill pays an account with
   * no code as this coin.
   */
  readonly coin?: AssetRef;
}

/** What the Across bridge is made from. */
export interface AcrossOptions {
  /** Reaches Across's API; the host's adapter names binference as the user agent. */
  readonly http: Http;
  /** The source chains it deposits on, each with Across's SpokePool in its registry. */
  readonly chains: readonly ChainRef[];
  /** The routes it serves from those chains, each to an EIP-155 destination. */
  readonly routes: readonly AcrossRoute[];
}
