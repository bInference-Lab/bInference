import { BinferenceError, type Clock, type Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

/** What follows the breaker, and where it logs. */
export interface BreakerFollowerOptions {
  /** The engine's work that applies each new version of the breaker once. */
  readonly followBreaker: Engine["followBreaker"];
  readonly logger: Logger;
}

/** What the breaker's timer runs, and what it runs on. */
export interface BreakerTimerOptions {
  /** The follower the startup called first, so both share what they last logged. */
  readonly follow: (call: { readonly signal: AbortSignal }) => Promise<void>;
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// The breaker's source answers from the worker's copy in memory, so a second costs nothing, and a
// pull reaches every card that waits within it (decision 0439).
const breakerEveryMs = 1_000;

/**
 * Follows the breaker once per call (decision 0439): logs `engine.breaker_unread` with the fault's
 * code once when its source stops answering, and `engine.breaker_read` once it answers again, so a
 * long outage is two lines; each pull and lift is logged as it is written.
 */
export function breakerFollower(
  options: BreakerFollowerOptions,
): (call: { readonly signal: AbortSignal }) => Promise<void> {
  const seen = { isUnread: false };
  return async (call) => {
    const followed = await options.followBreaker(call);
    if (followed.outcome === "unread") {
      if (!seen.isUnread) {
        options.logger.warn("engine.breaker_unread", { errorCode: followed.errorCode });
      }
      seen.isUnread = true;
      return;
    }
    if (seen.isUnread) {
      options.logger.info("engine.breaker_read", {});
    }
    seen.isUnread = false;
    if (followed.outcome === "pulled" || followed.outcome === "lifted") {
      options.logger.warn(`engine.breaker_${followed.outcome}`, {});
    }
  };
}

/**
 * Follows the breaker at the start, before the keys, the recovery and the repairs (decision 0439):
 * a source or a store that fails is logged and the start goes on with the state applied last.
 */
export async function followBreakerAtStart(
  follow: (call: { readonly signal: AbortSignal }) => Promise<void>,
  call: { readonly signal: AbortSignal; readonly logger: Logger },
): Promise<void> {
  try {
    await follow({ signal: call.signal });
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    call.logger.warn("engine.breaker_failed", { errorCode });
  }
}

/**
 * Follows the breaker every second while the engine serves, locked or not, since it signs
 * nothing. A failure of its write is logged as `engine.breaker_failed` and tried again a second
 * later.
 */
export function startBreakerTimer(options: BreakerTimerOptions): void {
  const { follow, ...rest } = options;
  startRepeatingTimer({
    ...rest,
    name: "breaker",
    run: follow,
    everyMs: breakerEveryMs,
    failedEvent: "engine.breaker_failed",
    isLocked: () => false,
  });
}
