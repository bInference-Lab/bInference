import type { Id } from "@binference/core";
import { asCopyOrder, type CopyOrder } from "./copy-fills.js";
import type { OrderStore } from "./ports.js";

const pageSize = 1_000;

/** Every copy order in the given states, page after page. */
export async function copyOrdersIn(
  orders: Pick<OrderStore, "list">,
  call: {
    readonly states: readonly ("active" | "paused")[];
    readonly signal: AbortSignal;
    readonly after?: { readonly createdAtMs: number; readonly id: Id<"ord"> };
  },
): Promise<readonly CopyOrder[]> {
  const { states, signal, after } = call;
  const base = { states, limit: pageSize };
  const page = await orders.list(after === undefined ? base : { ...base, after }, { signal });
  const last = page.at(-1);
  const copies = page.flatMap((order) => asCopyOrder(order) ?? []);
  if (last === undefined) {
    return copies;
  }
  const cursor = { createdAtMs: last.createdAtMs, id: last.id };
  return [...copies, ...(await copyOrdersIn(orders, { states, signal, after: cursor }))];
}
