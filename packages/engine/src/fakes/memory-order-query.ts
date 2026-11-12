import type { OrderQuery, OrderRecord } from "../orders/order-record.js";

function isAfter(order: OrderRecord, after: OrderQuery["after"]): boolean {
  return (
    after === undefined ||
    order.createdAtMs > after.createdAtMs ||
    (order.createdAtMs === after.createdAtMs && order.id > after.id)
  );
}

/**
 * Whether an order passes each filter of an in-memory order store's list query; an absent filter
 * passes every order, and a page starts after the order its cursor names.
 */
export function matchesOrderQuery(order: OrderRecord, query: OrderQuery): boolean {
  const { agentId, walletId, isPaper, expiresByMs } = query;
  return [
    query.states.includes(order.state),
    agentId === undefined || order.agentId === agentId,
    walletId === undefined || order.walletId === walletId,
    isPaper === undefined || order.isPaper === isPaper,
    expiresByMs === undefined || order.expiresAtMs <= expiresByMs,
    isAfter(order, query.after),
  ].every(Boolean);
}
