import type { Id } from "@binference/core";
import type { FillOutcome } from "./fill-orders.js";
import type { OrderFillRecord } from "./order-fill.js";
import type { OrderRecord } from "./order-record.js";

/**
 * What the price triggers, the order fills and their notices ask of the downtime re-check
 * (decisions 0267 and 0268): whether a price was read before the latest resume, and what each
 * price order's first fresh judgment and fill came to.
 */
export interface ResumeFence {
  /** Whether a price read at `readAtMs` was read before the latest resume: no fill runs on it. */
  isStale(readAtMs: number): boolean;
  /** Resolves once a resume that began is ready to take judgments; at once when none began. */
  ready(): Promise<void>;
  /** A price order judged on a price read at `readAtMs`: whether its trigger fires. */
  judged(call: {
    readonly order: Pick<OrderRecord, "id">;
    readonly readAtMs: number;
    readonly fires: boolean;
  }): void;
  /** What the fill of an order fired on a price read at `readAtMs` came to. */
  fillEnded(call: {
    readonly order: Id<"ord">;
    readonly readAtMs: number;
    readonly outcome: FillOutcome;
  }): void;
  /**
   * Whether the re-check reports a skip row in its one report instead of the row's own notices,
   * which are then marked announced without being sent. Fills are always told on their own.
   */
  holds(row: OrderFillRecord): boolean;
}
