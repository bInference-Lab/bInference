import { err } from "@binference/core";
import type { MoneyPath } from "../money-path/create-money-path.js";
import { type IdentityPathOptions, proposeIdentity } from "./propose-identity.js";

/**
 * The money path with identity registrations (decision 0335): a `registerIdentity` request takes
 * its own path, and every other request the money path's. Only the owner registers an identity,
 * which publishes its words for good: one the agent runtime or an MCP client proposes is
 * `intent.owner_only` before anything is read or stored. Registrations are proposed one at a time,
 * so two at once for one agent, from the CLI and the console, cannot both pass the check for an
 * open one before either is stored.
 */
export function withIdentities(path: MoneyPath, options: IdentityPathOptions): MoneyPath {
  // The last registration proposal; the next waits for it, whatever it answered.
  const line: { last: Promise<void> } = { last: Promise.resolve() };
  return {
    propose: async (request, proposer, call) => {
      if (request.kind !== "registerIdentity" || call.fill !== undefined) {
        return path.propose(request, proposer, call);
      }
      if (proposer.role !== "owner") {
        return err("intent.owner_only");
      }
      const turn = line.last.then(async () =>
        proposeIdentity(options, { request, proposer }, call.signal),
      );
      line.last = turn.then(
        () => undefined,
        () => undefined,
      );
      return turn;
    },
  };
}
