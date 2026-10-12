import type { Clock } from "@binference/core";

/** A wait that a new event ends early. */
export interface WakeUp {
  /** Ends the wait under way, or the next one at once when none is. */
  wake(): void;
  /** Waits until woken or until `timeoutMs` passes; rejects with the signal's reason on abort. */
  wait(timeoutMs: number, signal: AbortSignal): Promise<void>;
}

const idle = (): void => undefined;

/** Creates a {@link WakeUp} on the clock. */
export function createWakeUp(clock: Clock): WakeUp {
  let isWoken = false;
  let release = idle;
  return {
    wake() {
      isWoken = true;
      release();
    },
    async wait(timeoutMs, signal) {
      signal.throwIfAborted();
      if (!isWoken) {
        const done = new AbortController();
        const stop = (): void => done.abort();
        signal.addEventListener("abort", stop, { once: true });
        const woken = new Promise<void>((resolve) => {
          release = resolve;
        });
        await Promise.race([woken, clock.sleep(timeoutMs, done.signal).catch(() => undefined)]);
        release = idle;
        signal.removeEventListener("abort", stop);
        done.abort();
      }
      isWoken = false;
      signal.throwIfAborted();
    },
  };
}
