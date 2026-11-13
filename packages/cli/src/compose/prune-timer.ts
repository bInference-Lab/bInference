import type { Clock, Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { ProtocolServer } from "@binference/server";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

/** What the timer runs, and what it runs on. */
export interface PruneTimerOptions {
  /** The engine's prune of old webhook alerts and handled inbox entries (decision 0333). */
  readonly pruneRecords: Engine["pruneRecords"];
  /** The protocol server's prune of idempotency keys a day old (decision 0437). */
  readonly pruneKeys: ProtocolServer["pruneKeys"];
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
 * Prunes the webhook alerts kept past 90 days, the inbox entries handled more than 30 days ago and
 * the idempotency keys of a day ago but those of writes running now, a minute after the start and
 * then every day while the engine serves, locked or not. Each prune runs whether or not the other
 * fails; a failure is logged as `engine.prune_failed` and tried again a day later. Its closer
 * stops it.
 */
export function startPruneTimer(options: PruneTimerOptions): void {
  const { pruneRecords, pruneKeys, ...rest } = options;
  startRepeatingTimer({
    ...rest,
    name: "prune",
    run: async (call) => {
      const [records, keys] = await Promise.allSettled([pruneRecords(call), pruneKeys(call)]);
      const failed = [records, keys].find((outcome) => outcome.status === "rejected");
      if (failed !== undefined) {
        throw failed.reason;
      }
    },
    everyMs: pruneEveryMs,
    firstAfterMs: firstPruneAfterMs,
    failedEvent: "engine.prune_failed",
    isLocked: () => false,
  });
}
