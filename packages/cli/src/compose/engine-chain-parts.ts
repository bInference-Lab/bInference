import type { Logger } from "@binference/core";
import type { EngineOptions } from "@binference/engine";

// The engine's options a bridge needs: its bridges, its destinations and their readers.
type BridgingKey = "bridges" | "destinations" | "codeReaders" | "deliveryReaders";

/** What the engine finds on the chains besides prices and venues, as a composition gives it. */
export interface EngineChainParts {
  /** The name resolvers `name/resolve` and sends by name ask; every name is refused without. */
  readonly nameResolvers?: EngineOptions["nameResolvers"];
  /** The chains a bridge delivers to, where an address may be saved too; none when absent. */
  readonly destinations?: EngineOptions["destinations"];
  /**
   * The bridges, the chains they deliver to, the code readers and the delivery readers; nothing
   * bridges without them.
   */
  readonly bridging?: Pick<EngineOptions, BridgingKey>;
  /** The staking venues, each on its chain; nothing stakes without them (decision 0327). */
  readonly stakingVenues?: EngineOptions["stakingVenues"];
  /**
   * The identity registries and the release version; no agent registers without them (decision
   * 0335).
   */
  readonly identity?: EngineOptions["identity"];
  readonly logger: Logger;
}

/**
 * The engine's options of the parts it finds on the chains: the name resolvers, the chains a
 * bridge delivers to, the bridges with their readers and the log of their follower, the staking
 * venues and the identity registries, none when absent.
 */
export function chainPartsOf(
  parts: EngineChainParts,
): Pick<EngineOptions, "nameResolvers" | BridgingKey | "bridgeLog" | "stakingVenues" | "identity"> {
  const { nameResolvers, destinations, bridging, logger, identity } = parts;
  return {
    ...(nameResolvers === undefined ? {} : { nameResolvers }),
    ...(destinations === undefined ? {} : { destinations }),
    ...bridging,
    ...(bridging === undefined ? {} : { bridgeLog: logger.child("bridges") }),
    stakingVenues: parts.stakingVenues ?? [],
    ...(identity === undefined ? {} : { identity }),
  };
}
