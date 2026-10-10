import type { Clock, Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

/** What the timer runs, and what it runs on. */
export interface SettleTimerOptions {
  /** The engine's settle, which sends a change once its time has come. */
  readonly settle: Engine["settle"];
  /** Custody sends the change, so a locked engine waits for its keys. */
  readonly isLocked: () => boolean;
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// A rescue address's ceiling change is due 24 hours after the owner made it; a minute late is
// nothing next to that, and a read of the install each minute costs nothing.
const settleEveryMs = 60_000;

/**
 * Runs the engine's settle every minute while it serves, in the startup order's place for orders
 * and watchers, so a change that waited for its time goes out once it is due (decision 0110). A
 * locked engine skips it; a failure is logged and tried again a minute later. Its closer stops it.
 */
export function startSettleTimer(options: SettleTimerOptions): void {
  const { settle, ...rest } = options;
  startRepeatingTimer({
    ...rest,
    name: "settle",
    run: settle,
    everyMs: settleEveryMs,
    failedEvent: "engine.settle_failed",
  });
}
