import { BinferenceError } from "@binference/core";
import type { ReplyMessage, WorkerValue } from "../worker/worker-messages.schema.js";

/** How long a call waits, and the caller's signal that can stop the wait sooner. */
export interface WaitOptions {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

/** Calls sent to one worker that wait for their reply. */
export interface PendingCalls {
  /** Registers a call; refuses with `store.queue_full` when `limit` calls already wait. */
  add(options: WaitOptions): { readonly id: number; readonly reply: Promise<WorkerValue> };
  /** Settles the call a reply answers; a reply for a call that stopped waiting is dropped. */
  settle(reply: ReplyMessage): void;
  /** Fails one call, such as one whose message could not be sent. */
  fail(id: number, error: BinferenceError): void;
  /** Fails every waiting call. */
  failAll(error: BinferenceError): void;
}

interface Waiter {
  resolve(value: WorkerValue): void;
  reject(error: BinferenceError): void;
}

function stopped(signal: AbortSignal): BinferenceError {
  const timedOut = signal.reason instanceof DOMException && signal.reason.name === "TimeoutError";
  return new BinferenceError({
    code: timedOut ? "store.timeout" : "store.aborted",
    message:
      "The store call stopped waiting before its worker answered. A write may still commit, so read the state before you retry.",
    cause: signal.reason,
  });
}

function take(waiting: Map<number, Waiter>, id: number): Waiter | undefined {
  const waiter = waiting.get(id);
  waiting.delete(id);
  return waiter;
}

function wait(waiting: Map<number, Waiter>, id: number, signal: AbortSignal): Promise<WorkerValue> {
  return new Promise<WorkerValue>((resolve, reject) => {
    const onAbort = (): void => take(waiting, id)?.reject(stopped(signal));
    waiting.set(id, {
      resolve: (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      reject: (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    });
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * A table of waiting calls with at most `limit` entries; beyond it new calls are refused. A call
 * stops waiting when its signal aborts or its time runs out.
 */
export function createPendingCalls(limit: number): PendingCalls {
  const waiting = new Map<number, Waiter>();
  let nextId = 0;
  return {
    add(options) {
      if (waiting.size >= limit) {
        throw new BinferenceError({
          code: "store.queue_full",
          message: `${String(limit)} store calls already wait on this worker; try again shortly.`,
          retryable: true,
          details: { limit },
        });
      }
      const id = nextId;
      nextId += 1;
      const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);
      return { id, reply: wait(waiting, id, signal) };
    },
    settle(reply) {
      const waiter = take(waiting, reply.id);
      if (reply.ok) {
        waiter?.resolve(reply.value);
      } else {
        waiter?.reject(new BinferenceError(reply.error));
      }
    },
    fail(id, error) {
      take(waiting, id)?.reject(error);
    },
    failAll(error) {
      for (const id of waiting.keys()) {
        take(waiting, id)?.reject(error);
      }
    },
  };
}
