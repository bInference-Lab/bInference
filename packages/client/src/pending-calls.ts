import type { CallFrame, FailFrame, ReplyFrame } from "@binference/protocol";
import { clientError } from "./client-error.js";

/** The engine's answer to one call. */
export type CallAnswer = ReplyFrame | FailFrame;

/**
 * The calls that wait for an answer, by call id, across connections: a call survives a dropped
 * socket and is sent again on the next one. The map is bounded; a call over the bound is refused
 * with `client.busy` and never queued.
 */
export interface PendingCalls {
  /**
   * Holds a call until its answer, or until the signal aborts. Throws at once, holding nothing,
   * with `client.busy` when the map is full or with the reason of a signal already aborted.
   */
  wait(frame: CallFrame, signal: AbortSignal): Promise<CallAnswer>;
  /** Settles the call the answer names. An answer to no waiting call is dropped. */
  answer(frame: CallAnswer): void;
  /** The frame of every waiting call, oldest first, to send again on a new connection. */
  frames(): readonly CallFrame[];
  /** Rejects every waiting call with the error and empties the map. */
  rejectAll(error: Error): void;
}

interface Waiter {
  readonly frame: CallFrame;
  readonly resolve: (answer: CallAnswer) => void;
  readonly reject: (error: Error) => void;
}

interface Waiters {
  readonly byId: Map<string, Waiter>;
  readonly maxCalls: number;
}

// Not async: a refused call throws before the caller sends its frame.
function waitFor(waiters: Waiters, frame: CallFrame, signal: AbortSignal): Promise<CallAnswer> {
  signal.throwIfAborted();
  if (waiters.byId.size >= waiters.maxCalls) {
    throw clientError({
      code: "client.busy",
      message: `At most ${String(waiters.maxCalls)} calls wait for an answer at once.`,
      retryable: true,
    });
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      waiters.byId.delete(frame.id);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    waiters.byId.set(frame.id, {
      frame,
      resolve: (answer) => {
        signal.removeEventListener("abort", onAbort);
        resolve(answer);
      },
      reject: (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    });
  });
}

/** Creates the pending map, holding at most `maxCalls` calls. */
export function createPendingCalls(maxCalls: number): PendingCalls {
  const waiters: Waiters = { byId: new Map(), maxCalls };
  return {
    wait: (frame, signal) => waitFor(waiters, frame, signal),
    answer(frame) {
      const waiter = waiters.byId.get(frame.id);
      if (waiter !== undefined) {
        waiters.byId.delete(frame.id);
        waiter.resolve(frame);
      }
    },
    frames: () => [...waiters.byId.values()].map((waiter) => waiter.frame),
    rejectAll(error) {
      const all = [...waiters.byId.values()];
      waiters.byId.clear();
      for (const waiter of all) {
        waiter.reject(error);
      }
    },
  };
}
