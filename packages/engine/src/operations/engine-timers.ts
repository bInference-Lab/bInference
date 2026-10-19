import type { AlertFiring } from "../alerts/fire-alerts.js";
import type { OrderParts } from "../orders/create-order.js";
import type { DcaOrders } from "../orders/dca-orders.js";
import { tickOrders } from "../orders/tick-orders.js";
import type { ScheduleQueue } from "../schedules/run-schedules.js";

/** The schedule queue's run: the schedules whose time came, then the DCA orders' periods. */
export async function runQueue(
  parts: { readonly schedules: ScheduleQueue; readonly dca: DcaOrders },
  signal: AbortSignal,
): Promise<void> {
  await parts.schedules.run({ signal });
  await parts.dca.run({ signal });
}

/** The work that waits for no price: the orders' tick, then the alerts whose expiry came. */
export async function tickAll(
  parts: { readonly orders: OrderParts; readonly alerts: AlertFiring },
  signal: AbortSignal,
): Promise<void> {
  await tickOrders(parts.orders, signal);
  await parts.alerts.expire({ signal });
}
