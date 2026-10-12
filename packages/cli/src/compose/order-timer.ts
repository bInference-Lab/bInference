import type { Clock, Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

/** What the timer runs, and what it runs on. */
export interface OrderTimerOptions {
  /** The engine's work on auto orders that waits for no price (decision 0189). */
  readonly tickOrders: Engine["tickOrders"];
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// An answer moves its own order at once; the timer catches what no answer moves, such as a card
// whose timer ran out, within 10 seconds, with a few reads of waiting orders each time.
const orderTickEveryMs = 10_000;

/**
 * Runs the engine's order tick every 10 seconds while it serves, locked or not: it signs nothing.
 * A failure is logged as `engine.order_tick_failed` and tried again 10 seconds later. Its closer
 * stops it.
 */
export function startOrderTimer(options: OrderTimerOptions): void {
  const { tickOrders, ...rest } = options;
  startRepeatingTimer({
    ...rest,
    name: "order tick",
    run: tickOrders,
    everyMs: orderTickEveryMs,
    failedEvent: "engine.order_tick_failed",
    isLocked: () => false,
  });
}
