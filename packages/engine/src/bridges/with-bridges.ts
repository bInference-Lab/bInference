import type { MoneyPath } from "../money-path/create-money-path.js";
import { type BridgePathOptions, proposeBridge } from "./propose-bridge.js";

/**
 * The money path with the path of bridges (spec 6, section 5): a `bridge` request takes it, and
 * every other request the money path's.
 */
export function withBridges(path: MoneyPath, options: BridgePathOptions): MoneyPath {
  return {
    propose: async (request, proposer, call) =>
      request.kind === "bridge" && call.fill === undefined
        ? proposeBridge(options, { request, proposer }, call.signal)
        : path.propose(request, proposer, call),
  };
}
