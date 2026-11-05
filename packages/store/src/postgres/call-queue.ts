import { BinferenceError } from "@binference/core";

/** Calls that run one at a time, in the order they came. */
export interface CallQueue {
  /**
   * Runs `call` after every call queued before it and answers its outcome. Past the queue's
   * bound a call is refused with the retryable `store.queue_full`, never dropped.
   */
  run<Output>(call: () => Promise<Output>): Promise<Output>;
  /** Settles once every call queued so far has ended. */
  drained(): Promise<void>;
}

function ignore(): void {
  // A call's outcome goes to its caller; the queue only waits for it.
}

/** A queue of at most `limit` waiting calls (ENGINEERING.md 2.6); `what` names them in a refusal. */
export function createCallQueue(limit: number, what: string): CallQueue {
  let tail: Promise<void> = Promise.resolve();
  let waiting = 0;
  return {
    run: async (call) => {
      if (waiting >= limit) {
        throw new BinferenceError({
          code: "store.queue_full",
          message: `${String(limit)} ${what} already wait; try again shortly.`,
          retryable: true,
          details: { limit },
        });
      }
      waiting += 1;
      const turn = tail.then(call).finally(() => {
        waiting -= 1;
      });
      tail = turn.then(ignore, ignore);
      return turn;
    },
    drained: async () => tail,
  };
}
