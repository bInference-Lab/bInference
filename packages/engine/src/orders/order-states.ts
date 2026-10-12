import type { OrderState } from "@binference/protocol";

/** The states an auto order never leaves: it filled its last fill, was cancelled, expired or ended. */
export const endedOrderStates: readonly OrderState[] = ["filled", "cancelled", "expired", "ended"];

/** The states of an order that has not ended: waiting for its card, active, or paused. */
export const openOrderStates: readonly OrderState[] = ["awaiting_confirmation", "active", "paused"];

/** Whether an order in this state has ended, so that nothing moves it again. */
export function isOrderEnded(state: OrderState): boolean {
  return endedOrderStates.includes(state);
}
