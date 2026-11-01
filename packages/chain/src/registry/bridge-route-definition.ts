/**
 * A route a bridge serves from one chain to another: the token that leaves and the token that
 * arrives, each named by its symbol in its own chain's registry entry. Only a route the bridge's
 * own API serves is listed, so a chain or a token no bridge serves is offered nowhere.
 */
export interface BridgeRouteDefinition {
  /** The bridge, by its venue id, such as its plugin's name. */
  readonly venue: string;
  /** The token that leaves the source chain, by its registry symbol there. */
  readonly leaves: string;
  /** The destination chain, by its registry key. */
  readonly to: string;
  /**
   * The token that arrives, by its registry symbol on the destination chain, which may differ
   * from the one that left, as a dollar stablecoin arrives as the destination's own.
   */
  readonly arrives: string;
  /** The bridge's API endpoint the route was read from. */
  readonly source: string;
  /** The day it was read, YYYY-MM-DD. */
  readonly checkedOn: string;
  /**
   * Set only on a route the bridge fills by a swap into another token, such as USDC arriving as
   * USDG: the most the swap's rate may keep of the input less the bridge's fees, in basis points,
   * a dollar counted as a dollar. Left out, the least output is exactly the input less the fees.
   */
  readonly swapCapBps?: number;
}
