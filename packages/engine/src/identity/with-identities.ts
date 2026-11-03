import { err } from "@binference/core";
import type { MoneyPath } from "../money-path/create-money-path.js";
import { type IdentityPathOptions, proposeIdentity } from "./propose-identity.js";

/**
 * The money path with identity registrations (decision 0335): a `registerIdentity` request takes
 * its own path, and every other request the money path's. Only the owner registers an identity,
 * which publishes its words for good: one the agent runtime or an MCP client proposes is
 * `intent.owner_only` before anything is read or stored.
 */
export function withIdentities(path: MoneyPath, options: IdentityPathOptions): MoneyPath {
  return {
    propose: async (request, proposer, call) => {
      if (request.kind !== "registerIdentity" || call.fill !== undefined) {
        return path.propose(request, proposer, call);
      }
      return proposer.role === "owner"
        ? proposeIdentity(options, { request, proposer }, call.signal)
        : err("intent.owner_only");
    },
  };
}
