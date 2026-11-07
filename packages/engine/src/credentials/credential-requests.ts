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
  /** Every open request for a credential of the name, one per agent. */
  named(name: string): readonly OpenRequest[];
  /** Closes a request; false when it was not open. */
  close(request: string): boolean;
}

function find(byAgent: ReadonlyMap<string, OpenRequest>, request: string): OpenRequest | undefined {
  return [...byAgent.values()].find((each) => each.request === request);
}

// Calls `lapse` at the request's `closesAt`, unless `stop` aborts first.
function lapseAt(
  clock: Clock,
  request: OpenRequest,
  then: { readonly stop: AbortSignal; readonly lapse: (request: OpenRequest) => void },
): void {
  const wait = Math.max(0, request.closesAt - clock.now());
  clock.sleep(wait, then.stop).then(
    () => {
      then.lapse(request);
      return undefined;
    },
    () => undefined,
  );
}

/**
 * Creates the open credential requests: one per agent, a new one replacing the agent's last, each
 * answerable until its `closesAt`. A restart forgets them, as the turn that asked is gone too.
 * `expired` hears of each request at its `closesAt`, or found past it first, once.
 */
export function createCredentialRequests(options: {
  readonly clock: Clock;
  readonly expired: (request: OpenRequest) => void;
}): CredentialRequests {
  const { clock, expired } = options;
  const byAgent = new Map<string, OpenRequest>();
  // Each open request's timer, stopped when the request closes another way.
  const timers = new Map<string, AbortController>();
  const forget = (request: OpenRequest): void => {
    byAgent.delete(request.agent);
    timers.get(request.request)?.abort();
    timers.delete(request.request);
  };
  const lapse = (request: OpenRequest): void => {
    if (byAgent.get(request.agent)?.request === request.request) {
      forget(request);
      expired(request);
    }
  };
  const live = (request: OpenRequest | undefined): OpenRequest | undefined => {
    if (request === undefined || request.closesAt > clock.now()) {
      return request;
    }
    lapse(request);
    return undefined;
  };
  return {
    open(request) {
      const before = byAgent.get(request.agent);
      if (before !== undefined) {
        forget(before);
      }
      byAgent.set(request.agent, request);
      const timer = new AbortController();
      timers.set(request.request, timer);
      lapseAt(clock, request, { stop: timer.signal, lapse });
      return before;
    },
    get: (request) => live(find(byAgent, request)),
    openOf: (agent) => live(byAgent.get(agent)),
    named: (name) =>
      [...byAgent.values()].filter((each) => each.name === name && live(each) !== undefined),
    close(request) {
      const found = find(byAgent, request);
      if (found !== undefined) {
        forget(found);
      }
      return found !== undefined;
    },
  };
}
