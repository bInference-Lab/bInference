import { tellHeldCopies } from "./copy-held.js";
import type { OrderParts } from "./create-order.js";
import { expireDueOrders, noticeExpiringOrders } from "./expire-orders.js";
import { followWaitingOrders } from "./follow-order-card.js";

/**
 * One order tick (decision 0189): the waiting orders follow their cards, then the orders whose
 * expiry came expire, then the orders that end within 24 hours get their notice, then the copy
 * orders whose notice hour ended tell the skips it held back (decision 0260). A failure of one part
 * leaves the rest to the next tick.
 */
export async function tickOrders(parts: OrderParts, signal: AbortSignal): Promise<void> {
  await followWaitingOrders(parts, signal);
  await expireDueOrders(parts, signal);
  await noticeExpiringOrders(parts, signal);
  await tellHeldCopies(parts, signal);
}
