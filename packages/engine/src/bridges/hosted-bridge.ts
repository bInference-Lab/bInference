import type { AssetRef, Bridge } from "@binference/chain";

/**
 * A route a bridge serves, as the chain registry lists it (decision 0301): the token that leaves
 * the wallet's chain and the token that arrives on the destination chain, with each one's
 * decimals, and the destination's coin when the token that arrives is its wrapped coin.
 */
export interface BridgeRoute {
  readonly leaves: AssetRef;
  readonly arrives: AssetRef;
  readonly decimals: { readonly leaves: number; readonly arrives: number };
  readonly coin?: AssetRef;
}

/** A bridge the engine runs, with the routes the registry lists for it. */
export interface HostedBridge {
  readonly bridge: Bridge;
  readonly routes: readonly BridgeRoute[];
}
