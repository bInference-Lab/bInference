import type { Clock, Id } from "@binference/core";
import type { ResultOf } from "@binference/protocol";

/** A request for a credential the owner has not answered yet. */
export type OpenRequest = ResultOf<"turn/credential">;

/** The agents' open credential requests, one per agent, in memory (decision 0388). */
export interface CredentialRequests {
  /** Opens a request; answers the agent's request it replaces, if any. */
  open(request: OpenRequest): OpenRequest | undefined;
  /** The open request of an id; one past its time closes and is gone. */
  get(request: string): OpenRequest | undefined;
  /** The agent's open request; one past its time closes and is gone. */
  openOf(agent: Id<"agt">): OpenRequest | undefined;
  /** Closes a request; false when it was not open. */
  close(request: string): boolean;
}

/**
 * Creates the open credential requests: one per agent, a new one replacing the agent's last, each
 * answerable until its `closesAt`. A restart forgets them, as the turn that asked is gone too.
 * `expired` hears of each request found past its time.
 */
export function createCredentialRequests(options: {
  readonly clock: Clock;
  readonly expired: (request: OpenRequest) => void;
}): CredentialRequests {
  const byAgent = new Map<string, OpenRequest>();
  const live = (request: OpenRequest | undefined): OpenRequest | undefined => {
    if (request === undefined || request.closesAt > options.clock.now()) {
      return request;
    }
    byAgent.delete(request.agent);
    options.expired(request);
    return undefined;
  };
  return {
    open(request) {
      const before = byAgent.get(request.agent);
      byAgent.set(request.agent, request);
      return before;
    },
    get: (request) => live([...byAgent.values()].find((each) => each.request === request)),
    openOf: (agent) => live(byAgent.get(agent)),
    close(request) {
      const found = [...byAgent.values()].find((each) => each.request === request);
      return found !== undefined && byAgent.delete(found.agent);
    },
  };
}
