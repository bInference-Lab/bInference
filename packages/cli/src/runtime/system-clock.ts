import type { Clock } from "@binference/core";

// Node's timers take a delay of at most 2^31-1 ms; a longer one fires after 1 ms.
const maxTimerMs = 2 ** 31 - 1;

// One timer, cleared as soon as the signal aborts.
async function wait(delayMs: number, signal: AbortSignal): Promise<void> {
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
}

// Waits in timers of at most `maxTimerMs`, reading the time again after each, until `dueAtMs`.
async function waitUntil(dueAtMs: number, signal: AbortSignal): Promise<void> {
  const leftMs = dueAtMs - Date.now();
  if (leftMs <= 0) {
    return;
  }
  await wait(Math.min(leftMs, maxTimerMs), signal);
  await waitUntil(dueAtMs, signal);
}

/**
 * The clock of the real world: epoch milliseconds from `Date.now()` and sleeps on the event loop's
 * timers. A sleep longer than a timer can hold, such as a 30-day token expiry, runs as several
 * timers and reads the time after each. Only the composition root reads time this way; every
 * package takes the `Clock` port.
 */
export function createSystemClock(): Clock {
  return {
    now: () => Date.now(),
    async sleep(delayMs, signal) {
      signal.throwIfAborted();
      const dueAtMs = Date.now() + delayMs;
      await wait(Math.min(delayMs, maxTimerMs), signal);
      await waitUntil(dueAtMs, signal);
    },
  };
}
