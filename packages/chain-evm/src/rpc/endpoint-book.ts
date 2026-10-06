import type { Clock } from "@binference/core";
import type { EndpointHealth, RpcEndpoint, RpcFault } from "./rpc-call.js";

/** The failover's record of its endpoints: which are resting, and why. */
export interface EndpointBook {
  /** Healthy endpoints in their configured order, then resting ones, soonest back first. */
  inTurn(): readonly RpcEndpoint[];
  /** Records an answer, which ends a rest, or a fault, which starts one. */
  settle(endpoint: RpcEndpoint, fault: RpcFault | undefined): void;
  /** Each endpoint's health, in the configured order. */
  health(): readonly EndpointHealth[];
}

/** What an {@link EndpointBook} keeps. */
export interface EndpointBookOptions {
  readonly endpoints: readonly RpcEndpoint[];
  readonly clock: Clock;
  readonly restMs: number;
}

/** Creates the record of a failover's endpoints, all healthy at first. */
export function createEndpointBook(options: EndpointBookOptions): EndpointBook {
  const healthByName = new Map<string, EndpointHealth>();
  const healthOf = (endpoint: RpcEndpoint): EndpointHealth =>
    healthByName.get(endpoint.name) ?? { name: endpoint.name };
  const restEnd = (endpoint: RpcEndpoint): number => healthOf(endpoint).restingUntilMs ?? 0;
  return {
    inTurn() {
      const nowMs = options.clock.now();
      const healthy = options.endpoints.filter((endpoint) => restEnd(endpoint) <= nowMs);
      // A stable sort keeps the configured order between endpoints that come back together.
      const resting = options.endpoints
        .filter((endpoint) => restEnd(endpoint) > nowMs)
        .toSorted((left, right) => restEnd(left) - restEnd(right));
      return [...healthy, ...resting];
    },
    settle(endpoint, fault) {
      healthByName.set(
        endpoint.name,
        fault === undefined
          ? { name: endpoint.name }
          : {
              name: endpoint.name,
              restingUntilMs: options.clock.now() + options.restMs,
              lastFault: fault,
            },
      );
    },
    health: () => options.endpoints.map(healthOf),
  };
}
