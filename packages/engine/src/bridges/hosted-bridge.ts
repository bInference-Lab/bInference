import type { AssetRef, Bridge } from "@binference/chain";

/**
 * A route a bridge serves, as the chain registry lists it (decision 0301): the token that leaves
 * the wallet's chain and the token that arrives on the destination chain, with each one's
 * decimals, the destination's coin when the token that arrives is its wrapped coin, and the cap
 * on a swap's rate when the bridge fills it by a swap into another token.
 */
export interface BridgeRoute {
  readonly leaves: AssetRef;
  readonly arrives: AssetRef;
  readonly decimals: { readonly leaves: number; readonly arrives: number };
  readonly coin?: AssetRef;
  /**
   * The most the swap's rate may keep of the input less the bridge's fees, in basis points, on a
   * route the bridge fills by a swap; the card shows the rate, and a quote over it is refused
   * with `swap_rate` (decision 0323). Left out, the route is not a swap.
   */
  readonly swapCapBps?: number;
}

/** A bridge the engine runs, with the routes the registry lists for it. */
export interface HostedBridge {
  readonly bridge: Bridge;
  readonly routes: readonly BridgeRoute[];
}
