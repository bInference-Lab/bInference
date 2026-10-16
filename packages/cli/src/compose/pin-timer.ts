import type { Clock, Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

/** What the timer runs, and what it runs on. */
export interface PinTimerOptions {
  /** The engine's follow of the token launches waiting for their pin (decision 0234). */
  readonly checkPins: Engine["checkPins"];
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// A launch asks its launchpad for the pin at once; the timer asks again every 3 seconds, so a
// pinned launch opens its card within a few seconds of the launchpad's report.
const pinCheckEveryMs = 3_000;

/**
 * Asks the launchpads every 3 seconds whether they pinned the launches waiting for it, while the
 * engine serves, locked or not: it signs nothing. A failure is logged as
 * `engine.pin_check_failed` and tried again 3 seconds later. Its closer stops it.
 */
export function startPinTimer(options: PinTimerOptions): void {
  const { checkPins, ...rest } = options;
  startRepeatingTimer({
    ...rest,
    name: "pin check",
    run: async (call) => {
      await checkPins(call);
    },
    everyMs: pinCheckEveryMs,
    failedEvent: "engine.pin_check_failed",
    isLocked: () => false,
  });
}
