import type { Clock, Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

/** What the timer runs, and what it runs on. */
export interface ClaimReadyTimerOptions {
  /** The engine's teller of unstaked coin a claim can take now (decision 0327). */
  readonly tellClaimsReady: Engine["tellClaimsReady"];
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// An unbonding's ready time is a block's time; a pass each minute tells of it within a minute.
const claimReadyEveryMs = 60_000;

/**
 * Tells the owner of unstaked coin ready to claim every minute while the engine serves, locked or
 * not: it only reads and tells (decision 0327). A failure is logged as
 * `engine.claim_ready_failed` and tried again a minute later. Its closer stops it.
 */
export function startClaimReadyTimer(options: ClaimReadyTimerOptions): void {
  const { tellClaimsReady, ...rest } = options;
  startRepeatingTimer({
    ...rest,
    name: "claims ready",
    run: async (call) => {
      await tellClaimsReady(call);
    },
    everyMs: claimReadyEveryMs,
    failedEvent: "engine.claim_ready_failed",
    isLocked: () => false,
  });
}
