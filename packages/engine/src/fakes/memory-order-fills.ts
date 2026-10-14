import type { Id } from "@binference/core";
import {
  type FillAnnouncement,
  type OrderFillQuery,
  type OrderFillRecord,
  orderFillRecordSchema,
  type UnannouncedFillQuery,
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
  unannounced(
    query: UnannouncedFillQuery,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly OrderFillRecord[]>;
  markAnnounced(
    announcement: FillAnnouncement,
    options: { readonly signal: AbortSignal },
  ): Promise<void>;
  /** Checks a fill row inside another in-memory store's write; a broken rule throws. */
  checkFillNow(fill: OrderFillRecord): void;
  /** Writes a fill row `checkFillNow` passed, once the rest of the write has passed its checks. */
  saveFillNow(fill: OrderFillRecord): void;
  /** Whether an intent has a `filled` row already. */
  isCountedNow(intent: Id<"int">): boolean;
  countedFill(
    intent: Id<"int">,
    options: { readonly signal: AbortSignal },
  ): Promise<OrderFillRecord | undefined>;
}

/** What the fill rows read of the orders and intents beside them. */
export interface MemoryOrderFillsOptions {
  readonly hasOrder: (order: Id<"ord">) => boolean;
  readonly hasIntent: (intent: Id<"int">) => boolean;
}

type Fills = Map<Id<"fil">, OrderFillRecord>;

function isCounted(fills: Fills, intent: Id<"int">): boolean {
  return [...fills.values()].some((row) => row.intentId === intent && row.outcome === "filled");
}

// A fill row names a stored order and, when it names one, a stored intent, under a new id, with a
// reason exactly when it is a skip; one intent has one `filled` row at most.
function checkFill(fills: Fills, options: MemoryOrderFillsOptions, fill: OrderFillRecord): void {
  const { intentId } = fill;
  const isTwice = fill.outcome === "filled" && intentId !== undefined && isCounted(fills, intentId);
  const isKnown =
    options.hasOrder(fill.orderId) &&
    (intentId === undefined || options.hasIntent(intentId)) &&
    !fills.has(fill.id) &&
    !isTwice;
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

// Oldest first, then by id, as the SQLite store pages the rows to announce.
function byOldest(left: OrderFillRecord, right: OrderFillRecord): number {
  return -byNewest(left, right);
}

// Marks rows announced, keeping an earlier time; an unknown row, or one with no notices, throws
// before any row changes.
function announce(fills: Fills, announcement: FillAnnouncement): void {
  const rows = announcement.ids.map((id) => fills.get(id));
  const isKnown = rows.every((row) => row?.notices !== undefined);
  if (!isKnown) {
    throw constraintFault("an announcement names an unknown row or one without notices");
  }
  for (const row of rows) {
    if (row !== undefined && row.announcedAtMs === undefined) {
      fills.set(row.id, { ...row, announcedAtMs: announcement.atMs });
    }
  }
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
    isCountedNow: (intent) => isCounted(fills, intent),
    countedFill: async (intent, call) =>
      memoryCall(call, () =>
        structuredClone(
          [...fills.values()].find((row) => row.intentId === intent && row.outcome === "filled"),
        ),
      ),
    recordFill: async (fill, call) =>
      memoryCall(call, () => {
        checkFill(fills, options, fill);
        return save(fill);
      }),
    unannounced: async (query, call) =>
      memoryCall(call, () =>
        structuredClone(
          [...fills.values()]
            .filter((fill) => fill.notices !== undefined && fill.announcedAtMs === undefined)
            .toSorted(byOldest)
            .slice(0, query.limit),
        ),
      ),
    markAnnounced: async (announcement, call) =>
      memoryCall(call, () => {
        announce(fills, announcement);
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
