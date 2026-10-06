import { Worker } from "node:worker_threads";
import { BinferenceError } from "@binference/core";
import {
  workerMessageSchema,
  type CloseRequest,
  type IntegrityRequest,
  type MigrateRequest,
  type ReadyMessage,
  type TaskRequest,
  type VacuumRequest,
  type WorkerSetup,
  type WorkerValue,
} from "../worker/worker-messages.schema.js";
import { createPendingCalls, type PendingCalls, type WaitOptions } from "./pending-calls.js";

/** A request to a worker before it gets its id. */
export type CallBody =
  | Omit<TaskRequest, "id">
  | Omit<MigrateRequest, "id">
  | Omit<IntegrityRequest, "id">
  | Omit<VacuumRequest, "id">;

/** How {@link startWorker} starts one store worker. */
export interface WorkerLinkOptions {
  readonly url: URL;
  readonly setup: WorkerSetup;
  readonly execArgv: readonly string[];
  readonly signal: AbortSignal;
}

/** The main thread's side of one store worker. */
export interface WorkerLink {
  readonly ready: ReadyMessage;
  /** Sends a request; it runs after every request sent before it. */
  call(body: CallBody, options: WaitOptions): Promise<WorkerValue>;
  /** Lets queued requests finish, closes the connection and waits for the thread to end. */
  close(): Promise<void>;
}

// Each queue has a bound (ENGINEERING.md 2.6): past it a call is refused, never dropped.
const maxWaitingCalls = 10_000;
const closeTimeoutMs = 30_000;
const startTimeoutMs = 30_000;

function workerFault(database: string, cause: Error["cause"]): BinferenceError {
  return new BinferenceError({
    code: "store.worker_failed",
    message: `The ${database} store worker stopped; calls to it fail until the database is opened again.`,
    cause,
    details: { database },
  });
}

function startFault(
  code: "store.worker_failed" | "store.aborted",
  cause: Error["cause"],
): BinferenceError {
  return new BinferenceError({
    code,
    message:
      code === "store.aborted"
        ? "Opening the database stopped before its store worker was ready."
        : "A store worker stopped before it opened its database.",
    cause,
  });
}

function firstMessage(worker: Worker, signal: AbortSignal): Promise<ReadyMessage> {
  return new Promise<ReadyMessage>((resolve, reject) => {
    const settle = (outcome: () => void): void => {
      worker.off("message", onMessage).off("error", onFailure).off("exit", onFailure);
      signal.removeEventListener("abort", onAbort);
      outcome();
    };
    const onMessage = (message: WorkerValue): void => {
      const parsed = workerMessageSchema.safeParse(message);
      settle(() => {
        if (parsed.success && parsed.data.kind === "ready") {
          resolve(parsed.data);
        } else if (parsed.success && parsed.data.kind === "refused") {
          reject(new BinferenceError(parsed.data.error));
        } else {
          reject(startFault("store.worker_failed", parsed.error));
        }
      });
    };
    const onFailure = (cause: Error | number): void =>
      settle(() => reject(startFault("store.worker_failed", cause)));
    const onAbort = (): void => settle(() => reject(startFault("store.aborted", signal.reason)));
    worker.on("message", onMessage).on("error", onFailure).on("exit", onFailure);
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

type Send = (
  body: CallBody | Omit<CloseRequest, "id">,
  options: WaitOptions,
) => Promise<WorkerValue>;

// Messages to one worker arrive in the order they are posted, so requests run in that order.
function sender(worker: Worker, calls: PendingCalls): Send {
  return (body, options) => {
    const { id, reply } = calls.add(options);
    if (options.signal.aborted) {
      return reply;
    }
    try {
      worker.postMessage({ ...body, id }, []);
    } catch (error) {
      calls.fail(
        id,
        new BinferenceError({
          code: "store.bad_request",
          message: "A store call's input could not be copied to its worker.",
          cause: error,
        }),
      );
    }
    return reply;
  };
}

function notOpen(database: string, phase: "closing" | "failed"): BinferenceError {
  return phase === "failed"
    ? workerFault(database, "the worker failed earlier")
    : new BinferenceError({ code: "store.closed", message: `The ${database} database is closed.` });
}

function createLink(worker: Worker, ready: ReadyMessage, exited: Promise<void>): WorkerLink {
  const calls = createPendingCalls(maxWaitingCalls);
  const send = sender(worker, calls);
  let phase: "open" | "closing" | "failed" = "open";
  const fail = (cause: Error["cause"]): void => {
    phase = "failed";
    calls.failAll(workerFault(ready.database, cause));
  };
  worker.on("message", (message: WorkerValue) => {
    const parsed = workerMessageSchema.safeParse(message);
    if (parsed.success && parsed.data.kind === "reply") {
      calls.settle(parsed.data);
      return;
    }
    fail(parsed.error);
    void worker.terminate();
  });
  worker.on("error", fail);
  void exited.then(() => phase === "open" && fail("the worker thread ended"));
  return {
    ready,
    call: async (body, options) => {
      if (phase !== "open") {
        throw notOpen(ready.database, phase);
      }
      return send(body, options);
    },
    close: async () => {
      if (phase === "open") {
        phase = "closing";
        const options = { signal: AbortSignal.timeout(closeTimeoutMs), timeoutMs: closeTimeoutMs };
        await send({ kind: "close" }, options).catch(async () => worker.terminate());
      }
      await exited;
    },
  };
}

/**
 * Starts one store worker and waits until it has opened its connection. A worker that refuses
 * (a newer schema, a file it cannot open) has closed its connection and ended before this throws.
 */
export async function startWorker(options: WorkerLinkOptions): Promise<WorkerLink> {
  const worker = new Worker(options.url, {
    workerData: options.setup,
    execArgv: [...options.execArgv],
  });
  const exited = new Promise<void>((resolve) => {
    worker.once("exit", () => resolve());
  });
  try {
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(startTimeoutMs)]);
    const ready = await firstMessage(worker, signal);
    return createLink(worker, ready, exited);
  } catch (error) {
    await worker.terminate();
    await exited;
    throw error;
  }
}
