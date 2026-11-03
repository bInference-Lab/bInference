import type { Clock, Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

/** What the timer runs, and what it runs on. */
export interface PruneTimerOptions {
  /** The engine's prune of old webhook alerts and handled inbox entries (decision 0333). */
  readonly pruneRecords: Engine["pruneRecords"];
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

const pruneEveryMs = 86_400_000;
// The first prune comes soon after a start, so an engine that restarts more often than daily
// prunes too.
const firstPruneAfterMs = 60_000;

/**
 * Prunes the webhook alerts kept past 90 days and the inbox entries handled more than 30 days ago,
 * a minute after the start and then every day while the engine serves, locked or not. A failure
 * is logged as `engine.prune_failed` and tried again a day later. Its closer stops it.
 */
export function startPruneTimer(options: PruneTimerOptions): void {
  const { pruneRecords, ...rest } = options;
  startRepeatingTimer({
    ...rest,
    name: "prune",
    run: async (call) => {
      await pruneRecords(call);
    },
    everyMs: pruneEveryMs,
    firstAfterMs: firstPruneAfterMs,
    failedEvent: "engine.prune_failed",
    isLocked: () => false,
  });
}
