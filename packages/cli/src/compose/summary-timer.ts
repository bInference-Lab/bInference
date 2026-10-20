import type { Clock, Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

/** What the timer runs, and what it runs on. */
export interface SummaryTimerOptions {
  /** The engine's daily summaries, which tell each agent's day once per owner's date. */
  readonly sendDailySummaries: Engine["sendDailySummaries"];
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// A summary is due on a whole minute of the owner's wall clock, so a run each minute sends it
// within a minute of its time, with one read of each agent's latest summary.
const summaryEveryMs = 60_000;

/**
 * Runs the engine's daily summaries every minute while it serves, locked or not: they only read
 * and tell (decision 0273). The first run after a start sends a summary of today that the engine
 * missed while it was off. A failure is logged as `engine.daily_summary_failed` and tried again a
 * minute later. Its closer stops it.
 */
export function startSummaryTimer(options: SummaryTimerOptions): void {
  const { sendDailySummaries, ...rest } = options;
  startRepeatingTimer({
    ...rest,
    name: "daily summaries",
    run: sendDailySummaries,
    everyMs: summaryEveryMs,
    failedEvent: "engine.daily_summary_failed",
    isLocked: () => false,
  });
}
