import type { Id } from "@binference/core";
import type { OrderState } from "@binference/protocol";
import type { OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";

// How many orders one page of the read takes.
const pageSize = 1_000;

/**
 * Every order in the states named, the oldest first, page after page until a page comes back
 * empty, so a store that answers fewer than asked still hands over all of them.
 */
export async function allOrdersIn(
  orders: Pick<OrderStore, "list">,
  states: readonly OrderState[],
  signal: AbortSignal,
): Promise<readonly OrderRecord[]> {
  return pagesAfter({ orders, states, signal });
}

async function pagesAfter(read: {
  readonly orders: Pick<OrderStore, "list">;
  readonly states: readonly OrderState[];
  readonly signal: AbortSignal;
  readonly after?: { readonly createdAtMs: number; readonly id: Id<"ord"> };
}): Promise<readonly OrderRecord[]> {
  const { orders, states, signal, after } = read;
  const query = { states, limit: pageSize };
  const page = await orders.list(after === undefined ? query : { ...query, after }, { signal });
  const last = page.at(-1);
  if (last === undefined) {
    return page;
  }
  const cursor = { createdAtMs: last.createdAtMs, id: last.id };
  return [...page, ...(await pagesAfter({ ...read, after: cursor }))];
}
