/**
 * At most a number of reads at once on the runtime's link (decision 0442): a read past them waits
 * its turn in the runtime, first come first served, and is never refused for room.
 */
export interface ReadLimit {
  /** Runs the read once one of the places is free; a read still waiting rejects when its signal aborts. */
  run<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T>;
}

interface Queued {
  readonly start: () => void;
}

/** Creates a {@link ReadLimit} of `most` reads at once. */
export function createReadLimit(most: number): ReadLimit {
  const state = { running: 0 };
  const queue: Queued[] = [];
  const startNext = (): void => {
    const next = state.running < most ? queue.shift() : undefined;
    if (next !== undefined) {
      state.running += 1;
      next.start();
    }
  };
  const place = async (signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    if (state.running < most && queue.length === 0) {
      state.running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        queue.splice(queue.indexOf(queued), 1);
        reject(signal.reason);
      };
      const queued: Queued = {
        start: () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        },
      };
      signal.addEventListener("abort", onAbort, { once: true });
      queue.push(queued);
    });
  };
  return {
    async run(read, signal) {
      await place(signal);
      try {
        return await read();
      } finally {
        state.running -= 1;
        startNext();
      }
    },
  };
}
