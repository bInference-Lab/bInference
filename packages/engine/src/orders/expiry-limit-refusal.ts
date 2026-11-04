import type { OrderRequest } from "@binference/protocol";
import type { OrderRulesContext } from "./order-rules.js";

const dayMs = 86_400_000;

/**
 * Why a new auto order is refused for its end, before any card (decision 0364): it names an
 * `expiresAt` further ahead than the agent's `orderExpiryDays` from now. `undefined` for one that
 * names no end, or one at the limit or before it.
 */
export function expiryLimitRefusal(
  request: Pick<OrderRequest, "expiresAt">,
  context: Pick<OrderRulesContext, "nowMs" | "expiryDays">,
): "order.expiry_limit" | undefined {
  const { expiresAt } = request;
  const { nowMs, expiryDays } = context;
  return expiresAt !== undefined && expiresAt > nowMs + expiryDays * dayMs
    ? "order.expiry_limit"
    : undefined;
}
