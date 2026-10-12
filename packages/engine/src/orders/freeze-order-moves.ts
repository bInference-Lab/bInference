import type { Id } from "@binference/core";
import type { PublishPush } from "../pushes/engine-push.js";
import { moveOrder, type OrderTrigger } from "./order-machine.js";
import type { OrderMove, OrderQuery, OrderRecord } from "./order-record.js";
import { orderPush } from "./order-view-of.js";
import type { OrderStore } from "./ports.js";

// How many orders one read takes; a freeze reads page after page until none is left.
const pageSize = 1_000;

// Every order of the agent in the states, oldest first, a page at a time, so a freeze leaves none
// out however many orders the agent holds.
async function allOf(
  orders: Pick<OrderStore, "list">,
  query: Pick<OrderQuery, "states" | "agentId" | "after">,
  signal: AbortSignal,
): Promise<readonly OrderRecord[]> {
  const page = await orders.list({ ...query, limit: pageSize }, { signal });
  const last = page.at(-1);
  if (page.length < pageSize || last === undefined) {
    return page;
  }
  const after = { createdAtMs: last.createdAtMs, id: last.id };
  return [...page, ...(await allOf(orders, { ...query, after }, signal))];
}

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
    agents.map(async (agentId) => allOf(orders, { states, agentId }, signal)),
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
