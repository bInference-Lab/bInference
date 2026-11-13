/** How far back a rate quota counts: one minute (decision 0431). */
export const rateWindowMs = 60_000;

/**
 * Whether one more fits a rate quota: it fits while fewer than `quota` counted ones are in the
 * window. Otherwise `resumesAt` is when enough of them are older than the window for one more to
 * fit; a quota of 0 fits none ever, so it names no time.
 */
export type RateRoom =
  | { readonly fits: true }
  | { readonly fits: false; readonly resumesAt?: number };

/**
 * Judges a rate quota of `quota` over the times, in epoch milliseconds, of what it counts in the
 * window, in any order.
 */
export function rateRoom(times: readonly number[], quota: number): RateRoom {
  if (times.length < quota) {
    return { fits: true };
  }
  const leaving = times.toSorted((left, right) => left - right).at(times.length - quota);
  return leaving === undefined
    ? { fits: false }
    : { fits: false, resumesAt: leaving + rateWindowMs };
}
