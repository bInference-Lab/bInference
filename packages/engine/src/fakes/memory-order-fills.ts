import type { Id } from "@binference/core";
import {
  type OrderFillQuery,
  type OrderFillRecord,
  orderFillRecordSchema,
} from "../orders/order-fill.js";
import { constraintFault, memoryCall } from "./memory-call.js";

/**
 * The fill rows an in-memory order store keeps, whose rows another in-memory store's write can
 * add: the order store's `recordFill` and `fills`, and the checks a write runs first.
 */
export interface MemoryOrderFills {
  recordFill(
    fill: OrderFillRecord,
    options: { readonly signal: AbortSignal },
  ): Promise<OrderFillRecord>;
  fills(
    query: OrderFillQuery,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly OrderFillRecord[]>;
  /** Checks a fill row inside another in-memory store's write; a broken rule throws. */
  checkFillNow(fill: OrderFillRecord): void;
  /** Writes a fill row `checkFillNow` passed, once the rest of the write has passed its checks. */
  saveFillNow(fill: OrderFillRecord): void;
}

/** What the fill rows read of the orders and intents beside them. */
export interface MemoryOrderFillsOptions {
  readonly hasOrder: (order: Id<"ord">) => boolean;
  readonly hasIntent: (intent: Id<"int">) => boolean;
}

type Fills = Map<Id<"fil">, OrderFillRecord>;

// A fill row names a stored order and, when it names one, a stored intent, under a new id, with a
// reason exactly when it is a skip.
function checkFill(fills: Fills, options: MemoryOrderFillsOptions, fill: OrderFillRecord): void {
  const isKnown =
    options.hasOrder(fill.orderId) &&
    (fill.intentId === undefined || options.hasIntent(fill.intentId)) &&
    !fills.has(fill.id);
  if (!isKnown || !orderFillRecordSchema.safeParse(fill).success) {
    throw constraintFault(`fill ${fill.id} names an unknown order or intent, or breaks its rules`);
  }
}

// Newest first, then by id from the last, as the SQLite store pages them.
function byNewest(left: OrderFillRecord, right: OrderFillRecord): number {
  if (left.atMs !== right.atMs) {
    return right.atMs - left.atMs;
  }
  return left.id < right.id ? 1 : -1;
}

/** Creates the fill rows of an in-memory order store, empty. */
export function createMemoryOrderFills(options: MemoryOrderFillsOptions): MemoryOrderFills {
  const fills: Fills = new Map();
  const save = (fill: OrderFillRecord): OrderFillRecord => {
    fills.set(fill.id, structuredClone(fill));
    return structuredClone(fill);
  };
  return {
    checkFillNow: (fill) => {
      checkFill(fills, options, fill);
    },
    saveFillNow: (fill) => {
      save(fill);
    },
    recordFill: async (fill, call) =>
      memoryCall(call, () => {
        checkFill(fills, options, fill);
        return save(fill);
      }),
    fills: async (query, call) =>
      memoryCall(call, () =>
        structuredClone(
          [...fills.values()]
            .filter((fill) => fill.orderId === query.orderId)
            .toSorted(byNewest)
            .slice(0, query.limit),
        ),
      ),
  };
}
