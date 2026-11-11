import type { Clock } from "@binference/core";
import type { ChatSurface, ShellRequestView } from "@binference/protocol";
import type { AllowedStep } from "./allowed-match.js";

/**
 * A shell request the owner has not answered (decision 0409): its view, the command as it will
 * run, and the steps Always allow keeps.
 */
export interface OpenShellRequest {
  readonly view: ShellRequestView;
  /** The command's time limit in milliseconds; 0 for none. */
  readonly timeoutMs: number;
  /** The surface of the turn that asked, which the agent's next turn names. */
  readonly surface: ChatSurface;
  readonly steps: readonly AllowedStep[];
}

/** The agents' open shell requests, one per agent, in memory; a restart forgets them. */
export interface ShellRequests {
  /** Opens a request, and answers the agent's older one it closes, if any. */
  open(request: OpenShellRequest): OpenShellRequest | undefined;
  /** Takes an open request out by its id, so the first answer wins. */
  take(request: string): OpenShellRequest | undefined;
  /** The agent's open request, if any. */
  ofAgent(agent: string): OpenShellRequest | undefined;
  /** Every open request, of one agent or of all, oldest first. */
  list(agent?: string): readonly ShellRequestView[];
}

/**
 * Creates the open shell requests. Each closes at its `closesAt`: the request is taken out and
 * handed to `lapsed`, unless an answer, a newer request or a stop took it first.
 */
export function createShellRequests(options: {
  readonly clock: Clock;
  readonly lapsed: (request: OpenShellRequest) => void;
}): ShellRequests {
  const { clock, lapsed } = options;
  const open = new Map<string, OpenShellRequest>();
  const timers = new Map<string, AbortController>();
  const take = (id: string): OpenShellRequest | undefined => {
    const found = open.get(id);
    open.delete(id);
    timers.get(id)?.abort();
    timers.delete(id);
    return found;
  };
  const timeOut = (request: OpenShellRequest): void => {
    const timer = new AbortController();
    timers.set(request.view.request, timer);
    const wait = Math.max(0, request.view.closesAt - clock.now());
    clock.sleep(wait, timer.signal).then(
      () => {
        const taken = take(request.view.request);
        if (taken !== undefined) {
          lapsed(taken);
        }
        return undefined;
      },
      () => undefined,
    );
  };
  const ofAgent = (agent: string) =>
    [...open.values()].find((request) => request.view.agent === agent);
  return {
    open(request) {
      const older = ofAgent(request.view.agent);
      const replaced = older === undefined ? undefined : take(older.view.request);
      open.set(request.view.request, request);
      timeOut(request);
      return replaced;
    },
    take,
    ofAgent,
    list: (agent) =>
      [...open.values()]
        .filter((request) => agent === undefined || request.view.agent === agent)
        .map((request) => request.view),
  };
}
