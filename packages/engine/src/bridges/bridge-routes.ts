import { type AssetRef, assetRefParts, type ChainRef, isBridgeVenue } from "@binference/chain";
import type { BridgeRoute, HostedBridge } from "./hosted-bridge.js";

/** One route a hosted bridge serves for a bridge, with the bridge that serves it. */
export interface BridgeCandidate {
  readonly hosted: HostedBridge;
  readonly route: BridgeRoute;
  /** The bridge's deposit is a bridge wallet's alone, such as Relay's (decision 0307). */
  readonly isBridgeWallets: boolean;
}

/** The routes for a bridge, split by whether the agent's limits allow their venue. */
export interface BridgeCandidates {
  readonly allowed: readonly BridgeCandidate[];
  /** The venue of a route the limits do not allow, which the policy refuses as `venue_off`. */
  readonly offVenue?: string;
}

/**
 * The routes the hosted bridges serve from `sent` to `toChain` (decision 0319), in the order the
 * bridges and their routes are given: those whose venue the agent's limits allow, and the venue of
 * the first route they do not.
 */
export function bridgeCandidatesOf(
  bridges: readonly HostedBridge[],
  asked: {
    readonly sent: AssetRef;
    readonly toChain: ChainRef;
    readonly venues: readonly string[];
  },
): BridgeCandidates {
  const served = bridges.flatMap((hosted) =>
    hosted.routes
      .filter(
        (route) =>
          route.leaves === asked.sent && assetRefParts(route.arrives).chain === asked.toChain,
      )
      .map((route): BridgeCandidate => ({
        hosted,
        route,
        isBridgeWallets: isBridgeVenue(hosted.bridge),
      })),
  );
  const allowed = served.filter(({ hosted }) => asked.venues.includes(hosted.bridge.id));
  const off = served.find(({ hosted }) => !asked.venues.includes(hosted.bridge.id));
  return off === undefined || allowed.length > 0
    ? { allowed }
    : { allowed, offVenue: off.hosted.bridge.id };
}
