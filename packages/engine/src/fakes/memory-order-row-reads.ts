import type { Id } from "@binference/core";
import type { IntentRecord } from "../intents/intent-record.js";
import type { OrderFillRecord } from "../orders/order-fill.js";
import type { OrderRecord } from "../orders/order-record.js";
import type { OrderStore } from "../orders/ports.js";
import { memoryCall } from "./memory-call.js";
import { copyBuysOf } from "./memory-copy-buys.js";
import { fillCountsOf } from "./memory-fill-counts.js";

/** What the in-memory reads across every order's fill rows read. */
export interface RowReadSources {
  readonly orders: ReadonlyMap<Id<"ord">, OrderRecord>;
  readonly rowsNow: () => readonly OrderFillRecord[];
  readonly intentNow: ((intent: Id<"int">) => IntentRecord | undefined) | undefined;
}

/** The in-memory order store's reads across every order's fill rows: copy buys and fill counts. */
export function rowReadsOf(sources: RowReadSources): Pick<OrderStore, "copyBuys" | "fillCounts"> {
  const { orders, rowsNow, intentNow } = sources;
  return {
    copyBuys: async (query, call) =>
      memoryCall(call, () => copyBuysOf({ orders, rows: rowsNow(), intentNow }, query)),
    fillCounts: async (query, call) =>
      memoryCall(call, () => fillCountsOf({ orders, rows: rowsNow() }, query)),
  };
}
