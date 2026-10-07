import type { Clock } from "@binference/core";

/**
 * The clock of the real world: epoch milliseconds from `Date.now()` and sleeps on the event loop's
 * timers. Only the composition root reads time this way; every package takes the `Clock` port.
 */
export function createSystemClock(): Clock {
  return {
    now: () => Date.now(),
    async sleep(delayMs, signal) {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, delayMs);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}
