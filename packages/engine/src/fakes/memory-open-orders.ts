import type { Id } from "@binference/core";
import type { OrderRecord } from "../orders/order-record.js";

const openStates: ReadonlySet<OrderRecord["state"]> = new Set([
  "awaiting_confirmation",
  "active",
  "paused",
]);

/**
 * Whether the agent holds as many orders awaiting their card, active or paused as its quota
 * allows (decision 0431), as the SQLite store counts them; with no quota nothing is counted.
 */
export function isOverOpenOrders(
  orders: Iterable<OrderRecord>,
  agentId: Id<"agt">,
  quota: number | undefined,
): boolean {
  if (quota === undefined) {
    return false;
  }
  const open = [...orders].filter(
    (order) => order.agentId === agentId && openStates.has(order.state),
  );
  return open.length >= quota;
}
