import type { RpcEndpoint, RpcFailover } from "@binference/chain-evm";

/**
 * An RPC failover over the endpoints `endpoints` names at each request (decision 0230): a request
 * goes to the endpoints config names when it starts, and finishes where it started. The failover
 * is built again only when the list changed, so the endpoints' health carries over otherwise.
 */
export function followingRpc(
  endpoints: () => readonly RpcEndpoint[],
  build: (endpoints: readonly RpcEndpoint[]) => RpcFailover,
): RpcFailover {
  const held: { key?: string; failover?: RpcFailover } = {};
  const current = (): RpcFailover => {
    const now = endpoints();
    const key = JSON.stringify(now);
    if (held.failover === undefined || held.key !== key) {
      held.failover = build(now);
      held.key = key;
    }
    return held.failover;
  };
  return {
    request: async (call) => current().request(call),
    health: () => current().health(),
  };
}
