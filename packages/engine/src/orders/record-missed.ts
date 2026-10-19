import type { OrderFills } from "./fill-orders.js";
import type { OrderRecord } from "./order-record.js";

/**
 * Records as `missed` each order whose fill a stop cut off, as the start's repairs find them: the
 * orders are judged one at a time, in order, then each lost one gets its skip row and notice, one
 * write at a time. Answers how many it recorded.
 */
export async function recordMissed<Order extends OrderRecord>(
  fills: Pick<OrderFills, "skip">,
  call: {
    readonly orders: readonly Order[];
    readonly wasLost: (order: Order) => Promise<boolean>;
    readonly signal: AbortSignal;
  },
): Promise<number> {
  const { orders, wasLost, signal } = call;
  const lost: Order[] = [];
  for (const order of orders) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one order at a time, in order
    if (await wasLost(order)) {
      lost.push(order);
    }
  }
  for (const order of lost) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
    await fills.skip({ order: order.id, reason: "missed" }, { signal });
  }
  return lost.length;
}
