import type { Id } from "@binference/core";
import type { PublishPush } from "../pushes/engine-push.js";
import { moveOrder, type OrderTrigger } from "./order-machine.js";
import type { OrderMove, OrderRecord } from "./order-record.js";
import { orderPush } from "./order-view-of.js";
import type { OrderStore } from "./ports.js";

// How many orders of one agent a freeze reads; more than any agent holds while it trades.
const pageSize = 1_000;

async function movesOf(
  orders: Pick<OrderStore, "list">,
  agents: readonly Id<"agt">[],
  call: {
    readonly trigger: OrderTrigger;
    readonly states: readonly OrderRecord["state"][];
    readonly nowMs: number;
    readonly signal: AbortSignal;
  },
): Promise<readonly OrderMove[]> {
  const { trigger, states, nowMs, signal } = call;
  const listed = await Promise.all(
    agents.map(async (agentId) => orders.list({ states, agentId, limit: pageSize }, { signal })),
  );
  return listed.flat().flatMap((order) => {
    const move = moveOrder(order, trigger, nowMs);
    return move.ok ? [move.value] : [];
  });
}

/**
 * The moves a freeze of these agents writes in its own write (decision 0189): each active order to
 * `paused`, and each order waiting for its card to `cancelled`, under the versions read now.
 */
export async function freezeOrderMoves(
  orders: Pick<OrderStore, "list">,
  agents: readonly Id<"agt">[],
  call: { readonly nowMs: number; readonly signal: AbortSignal },
): Promise<readonly OrderMove[]> {
  const states = ["awaiting_confirmation", "active"] as const;
  return movesOf(orders, agents, { ...call, trigger: { type: "agent_frozen" }, states });
}

/**
 * The moves an unfreeze of these agents writes in its own write (decision 0189): each paused order
 * back to `active`, or to `expired` once past its expiry, under the versions read now.
 */
export async function unfreezeOrderMoves(
  orders: Pick<OrderStore, "list">,
  agents: readonly Id<"agt">[],
  call: { readonly nowMs: number; readonly signal: AbortSignal },
): Promise<readonly OrderMove[]> {
  const states = ["paused"] as const;
  return movesOf(orders, agents, { ...call, trigger: { type: "agent_unfrozen" }, states });
}

/** Pushes `order/changed` for each order a freeze or an unfreeze moved. */
export function announceOrders(publish: PublishPush, moved: readonly OrderRecord[]): void {
  for (const order of moved) {
    publish(orderPush(order, "order/changed"));
  }
}
