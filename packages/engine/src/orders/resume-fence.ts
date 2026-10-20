import type { Id } from "@binference/core";
import type { FillOutcome } from "./fill-orders.js";
import type { OrderFillRecord } from "./order-fill.js";
import type { OrderRecord } from "./order-record.js";

/** How a price order's trigger judged a price: it fires, its level is not met, or it re-arms. */
export type TriggerVerdict = "fires" | "not_met" | "rearming";

/**
 * What the price triggers, the order fills and their notices ask of the downtime re-check
 * (decisions 0267 and 0268): how many resumes the engine has seen, whether a price was read before
 * the latest, and what each price order's first fresh judgment and its fill came to.
 */
export interface ResumeFence {
  /**
   * How many resumes the engine has seen. A judgment carries the count it was made under, and a
   * fill whose count is behind no longer runs.
   */
  resumes(): number;
  /** Whether a price read at `readAtMs` was read before the latest resume: nothing judges it. */
  isStale(readAtMs: number): boolean;
  /** Resolves once a resume that began is ready to take judgments; at once when none began. */
  ready(): Promise<void>;
  /** A price order judged under `resumes` resumes, at `atMs`. */
  judged(call: {
    readonly order: Pick<OrderRecord, "id">;
    readonly resumes: number;
    readonly verdict: TriggerVerdict;
    readonly atMs: number;
  }): void;
  /** What the fill of an order fired under `resumes` resumes came to. */
  fillEnded(call: {
    readonly order: Id<"ord">;
    readonly resumes: number;
    readonly outcome: FillOutcome;
  }): void;
  /**
   * Whether the re-check reports a skip row in its one report instead of the row's own notices:
   * the skip of the fill its own judgment started, or a DCA or copy order's first skip of the
   * downtime. Such a row stays unannounced until the report went out. Fills are always told.
   */
  holds(row: OrderFillRecord): boolean;
}
