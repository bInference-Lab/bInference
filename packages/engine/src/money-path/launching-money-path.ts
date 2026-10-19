import { err } from "@binference/core";
import type { MoneyPath } from "./create-money-path.js";
import type { PinFollow } from "./follow-launch-pin.js";
import { followLaunchPins } from "./follow-launch-pins.js";
import { proposeLaunch } from "./propose-launch.js";
import type { LaunchPathOptions } from "./resolve-launch.js";

/** The money path with token launches (decision 0234), and the pin follow that moves them. */
export interface LaunchingMoneyPath extends MoneyPath {
  /**
   * Follows every live token launch on its way from its upload to its card (decisions 0234,
   * 0237), and answers how many it moved on or ended.
   */
  followPins(follow: PinFollow): Promise<number>;
}

/**
 * The money path with a token launch's own path (decision 0234): a launch request takes it, and
 * every other request, a fill among them, the money path's. Only the owner starts a launch: one
 * the agent runtime or an MCP client proposes is `intent.owner_only` before anything is read,
 * stored or uploaded (decision 0236). Without launch options an owner's launch stays on the money
 * path, which answers it as no route, and no pin is followed.
 */
export function withLaunches(
  path: MoneyPath,
  launch: LaunchPathOptions | undefined,
): LaunchingMoneyPath {
  return {
    propose: async (request, proposer, call) => {
      if (request.kind !== "launchToken" || call.fill !== undefined) {
        return path.propose(request, proposer, call);
      }
      if (proposer.role !== "owner") {
        return err("intent.owner_only");
      }
      return launch === undefined
        ? path.propose(request, proposer, call)
        : proposeLaunch(launch, { request, proposer, credential: call.credential }, call.signal);
    },
    followPins: async (call) => (launch === undefined ? 0 : followLaunchPins(launch, call)),
  };
}
