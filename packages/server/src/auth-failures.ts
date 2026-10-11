import type { Clock } from "@binference/core";

/** How failed sign-ins and pairings are counted, per source address and per credential. */
export interface AuthFailureLimits {
  /** The failures a key may have within `authFailureWindowMs` before it is locked out. */
  readonly authMaxFailures: number;
  readonly authFailureWindowMs: number;
  /** How long a key that reached the limit is refused. */
  readonly authLockoutMs: number;
  /** The most keys counted at once; past it, the key counted longest ago is forgotten. */
  readonly maxAuthKeys: number;
}

/** The failed sign-ins and pairings of a server, by key. */
export interface AuthFailures {
  /** Whether any of the keys is locked out now. */
  isLocked(keys: readonly string[]): boolean;
  /** Counts one failure for each key, and answers the keys this failure locked out. */
  fail(keys: readonly string[]): readonly string[];
}

interface Count {
  readonly failures: number;
  readonly windowStartMs: number;
  readonly lockedUntilMs?: number;
}

/**
 * Creates the failure count of a server: a key, such as a source address or a credential, that
 * fails `authMaxFailures` times within `authFailureWindowMs` is locked out for `authLockoutMs`.
 * Successes reset nothing, so a guesser cannot clear its count with a credential it holds. At most
 * `maxAuthKeys` keys are kept.
 */
export function createAuthFailures(
  limits: AuthFailureLimits & { readonly clock: Clock },
): AuthFailures {
  const counts = new Map<string, Count>();
  const isLockedNow = (key: string, nowMs: number): boolean => {
    const until = counts.get(key)?.lockedUntilMs;
    return until !== undefined && nowMs < until;
  };
  // One more failure of a key: a new window once the last one passed, and a lockout that, once
  // set, runs its full time.
  const failOne = (key: string, nowMs: number): boolean => {
    const known = counts.get(key);
    const isFresh =
      known === undefined || nowMs - known.windowStartMs >= limits.authFailureWindowMs;
    const failures = isFresh ? 1 : known.failures + 1;
    const windowStartMs = isFresh ? nowMs : known.windowStartMs;
    const wasLocked = isLockedNow(key, nowMs);
    const locks = !wasLocked && failures >= limits.authMaxFailures;
    const lockedUntilMs = locks ? nowMs + limits.authLockoutMs : known?.lockedUntilMs;
    counts.delete(key);
    counts.set(key, {
      failures,
      windowStartMs,
      ...(lockedUntilMs === undefined ? {} : { lockedUntilMs }),
    });
    const [oldest] = counts.keys();
    if (counts.size > limits.maxAuthKeys && oldest !== undefined) {
      counts.delete(oldest);
    }
    return locks;
  };
  return {
    isLocked: (keys) => keys.some((key) => isLockedNow(key, limits.clock.now())),
    fail: (keys) => {
      const nowMs = limits.clock.now();
      return keys.filter((key) => failOne(key, nowMs));
    },
  };
}
