import type { Clock, Logger, Random } from "@binference/core";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

/** What the timer runs, and what it runs on. */
export interface UpdateTimerOptions {
  /** One daily update check, and the counts with it. */
  readonly check: (call: { readonly signal: AbortSignal }) => Promise<void>;
  readonly clock: Clock;
  /** Picks the first check's moment, so installs do not all ask at once after a release. */
  readonly random: Random;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

const checkEveryMs = 86_400_000;
const firstCheckFromMs = 5 * 60_000;
const firstCheckSpreadMs = 60 * 60_000;

// A moment from 5 to 65 minutes after the start, from 4 random bytes.
function firstCheckAfterMs(random: Random): number {
  const draw = new DataView(random.bytes(4).buffer).getUint32(0);
  return firstCheckFromMs + (draw % firstCheckSpreadMs);
}

/**
 * Runs the daily update check while the engine serves, locked or not (decision 0355): the first a
 * random 5 to 65 minutes after the start, then every 24 hours. A check that fails is logged as
 * `update.check_failed` and the next one comes at its time. Its closer stops it.
 */
export function startUpdateTimer(options: UpdateTimerOptions): void {
  const { check, random, ...rest } = options;
  startRepeatingTimer({
    ...rest,
    name: "update check",
    run: check,
    everyMs: checkEveryMs,
    firstAfterMs: firstCheckAfterMs(random),
    failedEvent: "update.check_failed",
    isLocked: () => false,
  });
}
