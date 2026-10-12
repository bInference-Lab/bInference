import type { Id } from "@binference/core";
import type { OrderFillReason } from "./order-fill.js";

/** How long an order waits after its first skip in a row before its trigger may fill again. */
export const firstFillWaitMs = 15_000;
/** The longest an order waits after a skip: the wait doubles up to it. */
export const longestFillWaitMs = 300_000;

/**
 * The pace of an order's fills after a skip (decision 0195): an order whose trigger keeps holding
 * while it cannot fill tries again 15 seconds later, the wait doubling with each skip in a row up
 * to 5 minutes, and the owner hears each reason once in a row. A fill starts it over. It keeps its
 * state in memory, so a restart tries at once and may tell the owner once more.
 */
export interface FillPacing {
  /** Whether the order still waits after its last skip at `nowMs`. */
  isWaiting(order: Id<"ord">, nowMs: number): boolean;
  /** Records a skip at `nowMs`, and answers whether the owner hears it: a new reason in a row. */
  skipped(order: Id<"ord">, reason: OrderFillReason, nowMs: number): boolean;
  /** Starts the order over after a fill, or once it ended. */
  settled(order: Id<"ord">): void;
}

interface Waiting {
  readonly untilMs: number;
  readonly waitMs: number;
  readonly reason: OrderFillReason;
}

/** Creates the {@link FillPacing}, empty. It holds one entry per order that skipped and still runs. */
export function createFillPacing(): FillPacing {
  const waits = new Map<Id<"ord">, Waiting>();
  return {
    isWaiting: (order, nowMs) => nowMs < (waits.get(order)?.untilMs ?? nowMs),
    skipped(order, reason, nowMs) {
      const before = waits.get(order);
      const waitMs =
        before === undefined ? firstFillWaitMs : Math.min(before.waitMs * 2, longestFillWaitMs);
      waits.set(order, { untilMs: nowMs + waitMs, waitMs, reason });
      return before?.reason !== reason;
    },
    settled(order) {
      waits.delete(order);
    },
  };
}
