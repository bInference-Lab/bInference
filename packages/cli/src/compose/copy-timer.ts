import type { Clock, Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

/** What the timer runs, and what it runs on. */
export interface CopyTimerOptions {
  /** The engine's copy orders, which copy their leaders' trades the watcher stored. */
  readonly runCopies: Engine["runCopies"];
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// A leader trade is copied only within a minute of its block (decision 0260), and the leader
// watcher reads a block about every half second, so the copies run every second.
const copyEveryMs = 1_000;

/**
 * Runs the engine's copy orders every second while it serves, locked or not: a locked engine's
 * fills skip with `engine_locked`, so the owner hears of each trade it could not copy. A failure is
 * logged as `engine.copies_failed` and tried again a second later.
 */
export function startCopyTimer(options: CopyTimerOptions): void {
  const { runCopies, ...rest } = options;
  startRepeatingTimer({
    ...rest,
    name: "copies",
    run: runCopies,
    everyMs: copyEveryMs,
    failedEvent: "engine.copies_failed",
    isLocked: () => false,
  });
}
