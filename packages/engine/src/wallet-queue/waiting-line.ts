/** A work waiting for its turn: `start` lets it run, `leave` takes it out of the line. */
interface Waiter {
  readonly start: () => void;
  readonly leave: () => void;
}

/** The works waiting behind the running one on one account, oldest first. */
export interface WaitingLine {
  /** How many works wait. */
  readonly size: () => number;
  /** Resolves at this work's turn; leaves the line and rejects once `signal` aborts first. */
  readonly enter: (signal: AbortSignal) => Promise<void>;
  /** Lets the oldest waiting work run, and says whether one was waiting. */
  readonly next: () => boolean;
}

/** Creates an empty {@link WaitingLine}; its owner bounds how many works may enter it. */
export function createWaitingLine(): WaitingLine {
  const waiting: Waiter[] = [];
  return {
    size: () => waiting.length,
    enter: async (signal) =>
      new Promise<void>((resolve, reject) => {
        const waiter: Waiter = {
          start: () => {
            signal.removeEventListener("abort", waiter.leave);
            resolve();
          },
          leave: () => {
            waiting.splice(waiting.indexOf(waiter), 1);
            reject(signal.reason);
          },
        };
        waiting.push(waiter);
        signal.addEventListener("abort", waiter.leave, { once: true });
      }),
    next: () => {
      const waiter = waiting.shift();
      waiter?.start();
      return waiter !== undefined;
    },
  };
}
