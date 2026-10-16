import type { MoneyPath } from "./create-money-path.js";
import { followLaunchPins } from "./follow-launch-pin.js";
import { proposeLaunch } from "./propose-launch.js";
import type { LaunchPathOptions } from "./resolve-launch.js";

/** The money path with token launches (decision 0234), and the pin follow that moves them. */
export interface LaunchingMoneyPath extends MoneyPath {
  /**
   * Follows the pin of every live token launch waiting in `quoted`, and answers how many it moved
   * on or ended.
   */
  followPins(options: { readonly signal: AbortSignal }): Promise<number>;
}

/**
 * The money path with a token launch's own path (decision 0234): a launch request takes it, and
 * every other request, a fill among them, the money path's. Without launch options a launch stays
 * on the money path, which answers it as no route, and no pin is followed.
 */
export function withLaunches(
  path: MoneyPath,
  launch: LaunchPathOptions | undefined,
): LaunchingMoneyPath {
  return {
    propose: async (request, proposer, call) =>
      request.kind === "launchToken" && launch !== undefined && call.fill === undefined
        ? proposeLaunch(launch, { request, proposer }, call.signal)
        : path.propose(request, proposer, call),
    followPins: async (call) => (launch === undefined ? 0 : followLaunchPins(launch, call)),
  };
}
