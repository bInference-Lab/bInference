import type { Clock } from "@binference/core";

/**
 * The real time, which Privy checks a request's expiry against: unit tests run on fake timers,
 * the live suite and the leftover sweep on this.
 */
export const realClock: Clock = {
  now: () => Math.round(performance.timeOrigin + performance.now()),
  sleep: async (delayMs, signal) =>
    new Promise((resolve, reject) => {
      AbortSignal.timeout(delayMs).addEventListener("abort", () => {
        resolve();
      });
      signal.addEventListener("abort", () => {
        reject(signal.reason);
      });
    }),
};
