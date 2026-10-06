import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { BinferenceError, type ErrorCode, type Secret } from "@binference/core";
import {
  type PolledUpdate,
  type PollFault,
  type PollReply,
  type PollRequest,
  pollReplyOf,
} from "./poll-messages.schema.js";
import { fetchTimeoutMs, type UpdateFetcher } from "./update-fetcher.js";

/** The poll worker's entry beside this module: a `.ts` file in the source, `.mjs` in the build. */
export const pollWorker: URL = new URL(
  `./poll.worker${extname(fileURLToPath(import.meta.url))}`,
  import.meta.url,
);

/** What {@link openPollWorker} starts. */
export interface PollWorkerOptions {
  /** The worker entry: {@link pollWorker}, or a test's own entry. */
  readonly worker: URL;
  readonly token: Secret;
  /** A Bot API server other than Telegram's, without a trailing slash. */
  readonly apiRoot?: string;
  /** Node flags for the worker thread, such as a loader for TypeScript in tests. */
  readonly execArgv?: readonly string[];
}

/** A poll worker thread, fetching updates for the parent. */
export interface PollWorker extends UpdateFetcher {
  /** Ends the thread. Nothing is lost: an update is acknowledged only after it is stored. */
  close(): Promise<void>;
}

interface Waiter {
  readonly settle: (reply: PollReply) => void;
  readonly fail: (error: BinferenceError) => void;
}

// The poll loop waits for one batch at a time; the bound only catches a caller that does not.
const maxWaiting = 4;
// The worker's own timeout ends a call first; this one only catches a stuck thread.
const replyTimeoutMs = fetchTimeoutMs + 5000;

function fault(
  code: ErrorCode,
  message: string,
  options: Partial<PollFault> = {},
): BinferenceError {
  const { retryAfterMs } = options;
  return new BinferenceError({
    code,
    message,
    retryable: options.retryable ?? false,
    ...(retryAfterMs === undefined ? {} : { details: { retryAfterMs } }),
  });
}

function outcomeOf(reply: PollReply): readonly PolledUpdate[] | BinferenceError {
  return reply.kind === "updates"
    ? reply.updates
    : fault(reply.fault.code, "The poll worker's fetch failed.", reply.fault);
}

// Waits for one reply; an abort cancels the fetch in the worker and rejects at once.
function waitFor(
  waiters: Map<number, Waiter>,
  request: { readonly id: number; readonly signal: AbortSignal },
  cancel: () => void,
): Promise<readonly PolledUpdate[]> {
  const timeout = AbortSignal.timeout(replyTimeoutMs);
  const signal = AbortSignal.any([request.signal, timeout]);
  return new Promise((resolve, reject) => {
    const cleanUp = (): void => {
      waiters.delete(request.id);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (outcome: readonly PolledUpdate[] | Error): void => {
      cleanUp();
      if (outcome instanceof Error) {
        reject(outcome);
      } else {
        resolve(outcome);
      }
    };
    const onAbort = (): void => {
      cleanUp();
      cancel();
      reject(
        request.signal.aborted
          ? request.signal.reason
          : fault("telegram.unreachable", "The poll worker did not answer.", { retryable: true }),
      );
    };
    waiters.set(request.id, { settle: (reply) => finish(outcomeOf(reply)), fail: finish });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

interface WorkerLink {
  readonly send: (request: PollRequest) => void;
  /** Resolves when the thread has ended. */
  readonly exited: Promise<void>;
  /** The fault that ended the thread, once it has ended. */
  readonly failure: () => BinferenceError | undefined;
}

// Replies settle their waiters; a thread that fails or ends fails every waiter, then every call.
function link(worker: Worker, waiters: Map<number, Waiter>): WorkerLink {
  let failure: BinferenceError | undefined;
  const failAll = (error: BinferenceError): void => {
    failure ??= error;
    for (const waiter of waiters.values()) {
      waiter.fail(error);
    }
  };
  worker.on("message", (value) => {
    const reply = pollReplyOf(value);
    if (reply !== undefined) {
      waiters.get(reply.id)?.settle(reply);
    }
  });
  worker.on("error", () => failAll(fault("telegram.poller_failed", "The poll worker failed.")));
  const exited = new Promise<void>((resolve) => {
    worker.once("exit", () => {
      failAll(fault("telegram.poller_closed", "The poll worker has ended."));
      resolve();
    });
  });
  return { send: (request) => worker.postMessage(request, []), exited, failure: () => failure };
}

/**
 * Starts a poll worker: a thread that calls `getUpdates` with grammY for the parent, which stores
 * each update before it asks for the next offset. The token reaches the thread as worker data and
 * never appears in an error.
 */
export function openPollWorker(options: PollWorkerOptions): PollWorker {
  const worker = new Worker(options.worker, {
    workerData: {
      token: options.token.reveal(),
      ...(options.apiRoot === undefined ? {} : { apiRoot: options.apiRoot }),
    },
    execArgv: [...(options.execArgv ?? [])],
  });
  const waiters = new Map<number, Waiter>();
  const { send, exited, failure } = link(worker, waiters);
  let lastId = 0;
  return {
    fetch: async (offset, call) => {
      call.signal.throwIfAborted();
      const ended = failure();
      if (ended !== undefined || waiters.size >= maxWaiting) {
        throw ended ?? fault("telegram.poller_busy", "The poll worker is already fetching.");
      }
      lastId += 1;
      const id = lastId;
      const reply = waitFor(waiters, { id, signal: call.signal }, () =>
        send({ kind: "cancel", id }),
      );
      send({ kind: "fetch", id, ...(offset === undefined ? {} : { offset }) });
      return reply;
    },
    close: async () => {
      await worker.terminate();
      await exited;
    },
  };
}
