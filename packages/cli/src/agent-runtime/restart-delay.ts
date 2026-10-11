// The waits after each failure that follows the first: once at once, then 2, 4, 8, 16, 32 and 60
// seconds, then every 60 seconds (runtime spec, section 2.3).
const delaysMs = [0, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000] as const;
const longestMs = 60_000;

/** How long a runtime that stayed up at least this long resets the waits: 10 minutes. */
export const stableUptimeMs = 600_000;

/**
 * How long to wait before starting the runtime again after its exit, counting the exits since it
 * last stayed up 10 minutes: none for the first, then 2, 4, 8, 16, 32 and 60 seconds, then 60.
 */
export function restartDelayMs(failuresBefore: number): number {
  return delaysMs[failuresBefore] ?? longestMs;
}
