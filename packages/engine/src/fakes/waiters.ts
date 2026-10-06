/** Callers that wait until a fake has something new for them. */
export interface Waiters {
  /** Resolves at the next `wake`; rejects with the signal's reason once the signal aborts. */
  wait(signal: AbortSignal): Promise<void>;
  /** Wakes every caller waiting now. */
  wake(): void;
}

/** Creates an empty set of {@link Waiters}. */
export function createWaiters(): Waiters {
  const waiting = new Set<() => void>();
  return {
    wait: async (signal) =>
      new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const onAbort = (): void => {
          waiting.delete(done);
          reject(signal.reason);
        };
        const done = (): void => {
          waiting.delete(done);
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        signal.addEventListener("abort", onAbort, { once: true });
        waiting.add(done);
      }),
    wake: () => {
      for (const done of waiting) {
        done();
      }
    },
  };
}
