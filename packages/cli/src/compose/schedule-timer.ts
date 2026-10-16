import type { Clock, Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

/** What the timer runs, and what it runs on. */
export interface ScheduleTimerOptions {
  /** The engine's schedule queue, which wakes the agent at each schedule's time. */
  readonly runSchedules: Engine["runSchedules"];
  /** A locked engine runs no schedule: a stretch locked counts as missed (decision 0232). */
  readonly isLocked: () => boolean;
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// A schedule runs on whole minutes, so a run within 10 seconds of its time is on time, and one
// read of the due schedules every 10 seconds costs nothing.
const scheduleEveryMs = 10_000;

/**
 * Runs the engine's schedule queue every 10 seconds while it serves and is unlocked. The first run
 * after a start, an unlock or a wake from sleep runs each schedule that missed its time once. A
 * failure is logged as `engine.schedules_failed` and tried again 10 seconds later.
 */
export function startScheduleTimer(options: ScheduleTimerOptions): void {
  const { runSchedules, ...rest } = options;
  startRepeatingTimer({
    ...rest,
    name: "schedules",
    run: runSchedules,
    everyMs: scheduleEveryMs,
    failedEvent: "engine.schedules_failed",
  });
}
