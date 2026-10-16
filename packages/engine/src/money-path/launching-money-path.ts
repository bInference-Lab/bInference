import type { MoneyPath } from "./create-money-path.js";
import { proposeLaunch } from "./propose-launch.js";
import type { LaunchPathOptions } from "./resolve-launch.js";

/**
 * The money path with a token launch's own path (decision 0234): a launch request takes it, and
 * every other request, a fill among them, the money path's. Without launch options a launch stays
 * on the money path, which answers it as no route.
 */
export function withLaunches(path: MoneyPath, launch: LaunchPathOptions | undefined): MoneyPath {
  return {
    propose: async (request, proposer, call) =>
      request.kind === "launchToken" && launch !== undefined && call.fill === undefined
        ? proposeLaunch(launch, { request, proposer }, call.signal)
        : path.propose(request, proposer, call),
  };
}
