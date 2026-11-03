import type { AccountRef, AssetRef, ChainRef, Clock, Http, Secret } from "@binference/plugin-sdk";
import type { Address } from "viem";

/**
 * A route Relay serves, as the registry lists it (decision 0301): the token that leaves the source
 * chain and the token that arrives on the destination chain, an EVM chain or Solana. The bridge
 * quotes no other pair.
 */
export interface RelayRoute {
  readonly leaves: AssetRef;
  readonly arrives: AssetRef;
  /** Each token's decimals, as the registry lists them; Relay's answer must name the same. */
  readonly decimals: { readonly leaves: number; readonly arrives: number };
  /**
   * Set only on a route Relay fills by a swap into another token, as the registry lists it: the
   * most the swap's rate may keep of the input less Relay's fees, in basis points (decision 0323).
   * Left out, the least output is exactly the input less the fees.
   */
  readonly swapCapBps?: number;
}

/** What the Relay bridge is made from. */
export interface RelayOptions {
  /** Reaches Relay's API; the host's adapter names binference as the user agent. */
  readonly http: Http;
  /** When a quote is given, so the bridge can say until when it holds. */
  readonly clock: Clock;
  /**
   * The owner's Relay API key, sent as `x-api-key` on every request when there is one; Relay's API
   * answers without one too, at a lower rate (decision 0322).
   */
  readonly key?: Secret;
  /** The source chains it deposits on, each with Relay's depository in its registry. */
  readonly chains: readonly ChainRef[];
  /** The routes it serves from those chains. */
  readonly routes: readonly RelayRoute[];
  /**
   * Relay's depository on each source chain, as the registry lists it, whose deposit event alone
   * names the order a deposit pays (decision 0320).
   */
  readonly depositories: Readonly<Partial<Record<ChainRef, AccountRef>>>;
  /**
   * Relay's solver: the key whose signature an order's id must carry, which an order must name,
   * and whose transfers alone pay a fill or a refund. The composition root names
   * {@link relaySolver}, as Relay's contract addresses page lists it.
   */
  readonly solver: Address;
}
