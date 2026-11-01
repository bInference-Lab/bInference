import type { AccountCodeReader, DeliveryReader } from "@binference/chain";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import type { EngineOptions } from "../operations/create-engine.js";
import { createPositions } from "../positions/create-positions.js";
import { createBridgeFollower } from "./follow-bridges.js";
import type { HostedBridge } from "./hosted-bridge.js";

/** What the engine bridges with (decision 0297). */
export interface BridgeOptions {
  /** The bridges the engine runs, with their registry routes; with none, a bridge finds no route. */
  readonly bridges?: readonly HostedBridge[];
  /**
   * The account code readers of the wallets' chains, which tell the rescue address a plain wallet
   * before a bridge pays it on another chain (decision 0318); without one, it is never paid there.
   */
  readonly codeReaders?: readonly AccountCodeReader[];
  /**
   * The delivery readers of the chains bridges deliver to and of the chains they leave from, which
   * alone settle a bridge (decision 0297); without one for its chain, a bridge stays in transit.
   */
  readonly deliveryReaders?: readonly DeliveryReader[];
}

/** The engine's work on bridges in transit, which the composition root runs on a timer. */
export interface BridgeWork {
  /**
   * Reads where each bridge in transit stands, marks a late one and settles one a read found
   * delivered or refunded (decision 0297).
   */
  readonly followBridges: (options: { readonly signal: AbortSignal }) => Promise<void>;
}

/** The engine's follower of bridges in transit, over its stores, bridges and delivery readers. */
export function bridgeWorkOf(options: EngineOptions, stored: StoredIntents): BridgeWork {
  const follower = createBridgeFollower({
    bridges: options.stores.bridges,
    stored,
    hosted: options.bridges ?? [],
    readers: options.deliveryReaders ?? [],
    custody: options.custody,
    positions: createPositions({ store: options.positions, prices: options.prices }),
    positionStore: options.positions,
    install: options.stores.install,
    chains: options.chains,
    publish: options.publish,
    clock: options.clock,
  });
  return { followBridges: follower.follow };
}
