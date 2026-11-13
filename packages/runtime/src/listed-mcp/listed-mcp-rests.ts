import type { Clock } from "@binference/core";
import type { ConnectionFailure } from "./listed-mcp-connection.js";

/** The failures in a row after which an agent's listing rests (decision 0428). */
const failuresBeforeRest = 3;
const firstRestMs = 30_000;
const longestRestMs = 600_000;

/** When an agent's listing rests, after the failures its server caused. */
export interface ListedRests {
  /** Counts a failure; the third in a row and each after rests the listing, a `429` at once. */
  failed(failure: ConnectionFailure): void;
  /** A good answer: the count starts again, and a rest it lands in ends. */
  answered(): void;
  /** The whole seconds the listing still rests, or none while it does not. */
  restingSeconds(): number | undefined;
  /** The reason of the latest failure, which the `health` line names. */
  lastReason(): string;
}

// The rest after a failure: the server's own wait for a 429, between 1 and 600 seconds and 30
// when it gives none, else 30 seconds from the third failure in a row, doubling up to 10 minutes.
function restMsOf(failures: number, failure: ConnectionFailure): number {
  if (failure.reason === "rate_limited") {
    const seconds = failure.retryAfterSeconds ?? firstRestMs / 1_000;
    return Math.min(Math.max(seconds, 1) * 1_000, longestRestMs);
  }
  if (failures < failuresBeforeRest) {
    return 0;
  }
  return Math.min(firstRestMs * 2 ** (failures - failuresBeforeRest), longestRestMs);
}

/** Creates the {@link ListedRests} of one agent's listing, on the clock. */
export function createListedRests(clock: Clock): ListedRests {
  let failures = 0;
  let restUntilMs = 0;
  let reason = "";
  return {
    failed(failure) {
      failures += 1;
      reason = failure.reason;
      const restMs = restMsOf(failures, failure);
      if (restMs > 0) {
        restUntilMs = clock.now() + restMs;
      }
    },
    answered() {
      failures = 0;
      restUntilMs = 0;
    },
    restingSeconds() {
      const left = restUntilMs - clock.now();
      return left > 0 ? Math.ceil(left / 1_000) : undefined;
    },
    lastReason: () => reason,
  };
}
