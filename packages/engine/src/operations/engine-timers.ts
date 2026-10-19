import type { Clock } from "@binference/core";
import type { AlertFiring } from "../alerts/fire-alerts.js";
import type { OrderParts } from "../orders/create-order.js";
import type { DcaOrders } from "../orders/dca-orders.js";
import { tickOrders } from "../orders/tick-orders.js";
import type { ScheduleQueue } from "../schedules/run-schedules.js";

/**
 * The schedule queue's run: the schedules whose time came, then the DCA orders' periods, all
 * judged at the instant the run began. The DCA orders run even when the schedules failed; the
 * first failure is thrown once both ran.
 */
export async function runQueue(
  parts: { readonly schedules: ScheduleQueue; readonly dca: DcaOrders; readonly clock: Clock },
  signal: AbortSignal,
): Promise<void> {
  const atMs = parts.clock.now();
  const [schedules, dca] = await Promise.allSettled([
    parts.schedules.run({ signal }),
    parts.dca.run({ signal, atMs }),
  ]);
  if (schedules.status === "rejected") {
    throw schedules.reason;
  }
  if (dca.status === "rejected") {
    throw dca.reason;
  }
}

/**
 * The work that waits for no price: the orders' tick, then the alerts whose expiry came, then the
 * matches the alerts' ended notice hours held back.
 */
export async function tickAll(
  parts: { readonly orders: OrderParts; readonly alerts: AlertFiring },
  signal: AbortSignal,
): Promise<void> {
  await tickOrders(parts.orders, signal);
  await parts.alerts.expire({ signal });
  await parts.alerts.tellHeld({ signal });
}
