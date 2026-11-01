import type { Clock, Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

/** What the timer runs, and what it runs on. */
export interface BridgeTimerOptions {
  /** The engine's follow of the bridges in transit (decision 0297). */
  readonly followBridges: Engine["followBridges"];
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// A pass reads each bridge in transit once, so a delivery settles within this of being final.
const bridgeFollowEveryMs = 30_000;

/**
 * Follows the bridges in transit every 30 seconds while the engine serves, locked or not: it reads
 * and settles, and signs nothing (decision 0320). A failure is logged as
 * `engine.bridge_follow_failed` and tried again 30 seconds later. Its closer stops it.
 */
export function startBridgeTimer(options: BridgeTimerOptions): void {
  const { followBridges, ...rest } = options;
  startRepeatingTimer({
    ...rest,
    name: "bridge follow",
    run: followBridges,
    everyMs: bridgeFollowEveryMs,
    failedEvent: "engine.bridge_follow_failed",
    isLocked: () => false,
  });
}
