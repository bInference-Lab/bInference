import type { AccountRef } from "@binference/chain";
import type { OrderRequest, OrderState } from "@binference/protocol";

/**
 * The order states in which a copy order holds its leader's slot among the tracked wallets
 * (decision 0251): awaiting its card, active, or paused while its agent is frozen.
 */
export const trackingOrderStates: readonly OrderState[] = [
  "awaiting_confirmation",
  "active",
  "paused",
];

/** The leader a copy order follows; none for any other kind. */
export function copyLeaderOf(request: OrderRequest): AccountRef | undefined {
  return request.kind === "copy" ? request.trigger.leader : undefined;
}
