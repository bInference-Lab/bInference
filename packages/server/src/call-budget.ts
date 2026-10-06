import type { Clock } from "@binference/core";

/** A connection's call rate: a token bucket refilled on the clock. */
export interface CallBudget {
  /** Spends one call; `false` when the burst is spent and the rate has not refilled it. */
  take(): boolean;
}

/** The rate and burst of a {@link CallBudget}. */
export interface CallBudgetOptions {
  readonly clock: Clock;
  readonly callsPerSecond: number;
  readonly callBurst: number;
}

/**
 * Creates a full {@link CallBudget}: `callBurst` calls at once, then `callsPerSecond`, measured on
 * the clock so tests drive it with a manual one.
 */
export function createCallBudget(options: CallBudgetOptions): CallBudget {
  let tokens = options.callBurst;
  let refilledAt = options.clock.now();
  return {
    take() {
      const now = options.clock.now();
      const earned = (Math.max(0, now - refilledAt) * options.callsPerSecond) / 1_000;
      tokens = Math.min(options.callBurst, tokens + earned);
      refilledAt = now;
      if (tokens < 1) {
        return false;
      }
      tokens -= 1;
      return true;
    },
  };
}
