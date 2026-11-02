import type { MoneyPath } from "../money-path/create-money-path.js";
import { proposeStake, type StakePathOptions } from "./propose-stake.js";

/**
 * The money path with the path of staking moves (spec 6, section 5): a `stake` request takes it,
 * and every other request the money path's.
 */
export function withStakes(path: MoneyPath, options: StakePathOptions): MoneyPath {
  return {
    propose: async (request, proposer, call) =>
      request.kind === "stake" && call.fill === undefined
        ? proposeStake(options, { request, proposer }, call.signal)
        : path.propose(request, proposer, call),
  };
}
