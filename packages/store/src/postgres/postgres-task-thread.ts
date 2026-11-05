import { Worker } from "node:worker_threads";
import { BinferenceError } from "@binference/core";
import type { WorkerValue } from "../worker/worker-messages.schema.js";
import { createCallQueue } from "./call-queue.js";
import { postgresLimits } from "./pool-config.js";
import type { PostgresConnection } from "./postgres-connection.js";
import {
  bridgeWords,
  fromTaskThreadSchema,
  type PostgresTaskSetup,
  type ToTaskThread,
} from "./task-bridge-messages.js";
import { type RunControl, startTaskRun, type TaskRun } from "./task-run.js";

/**
 * How long a task waits for one statement's answer by default: a second past the server's
 * `statement_timeout`, so a statement the server ends is answered before the task gives up.
 */
const taskWaitMs: number = postgresLimits.statementTimeoutMs + 1_000;

const startTimeoutMs = 30_000;
const maxWaitingRuns = 10_000;

/** How {@link startPostgresTaskThread} starts a task thread. */
export interface PostgresTaskThreadOptions {
  /** The database's store worker entry, such as `engineWorker`. */
  readonly worker: URL;
  /** Node options for the thread, such as a TypeScript loader when tests run source. */
  readonly execArgv?: readonly string[];
  /** How long a task waits for one statement's answer; {@link taskWaitMs} by default. */
  readonly waitMs?: number;
  readonly signal: AbortSignal;
}

/** One task to run: its name, the install's schema and its encoded input. */
interface TaskJob {
  readonly task: string;
  readonly schema: string;
  readonly input: WorkerValue;
}

/** A thread that runs one database's store tasks for Postgres transactions held here. */
export interface PostgresTaskThread {
  /** The name the database's definition gives it, such as `engine`. */
  readonly database: string;
  /**
   * Runs a task in the transaction `connection` belongs to, after every run sent before it, and
   * returns the task's encoded output. It settles only once the task ended and no statement of
   * it still runs; see `TaskRun.settled` for what it rejects with.
   */
  run<Schema>(
    job: TaskJob,
    connection: PostgresConnection<Schema>,
    control: RunControl,
  ): Promise<WorkerValue>;
  /** Lets every run sent so far end, then ends the thread. */
  close(): Promise<void>;
}

/** A started thread: its worker, the shared words, and the end of the thread. */
interface Started {
  readonly worker: Worker;
  readonly words: Int32Array;
  readonly exited: Promise<void>;
  readonly database: string;
}

/** The statement side's end of one thread, serving one run at a time. */
interface Channel {
  readonly post: (message: ToTaskThread) => void;
  /** Marks the run aborted and wakes the task thread, which stops where it waits. */
  readonly abort: (run: number) => void;
  /** Hands the thread's messages to `run` until the next call. */
  readonly serve: (run: TaskRun | undefined) => void;
  readonly fault: () => BinferenceError | undefined;
}

function threadFault(database: string, cause: Error["cause"]): BinferenceError {
  return new BinferenceError({
    code: "store.worker_failed",
    message: `The ${database} Postgres task thread stopped; calls to it fail until it is started again.`,
    cause,
    details: { database },
  });
}

function startFault(cause: Error["cause"]): BinferenceError {
  return new BinferenceError({
    code: "store.worker_failed",
    message: "A Postgres task thread stopped before it served its database.",
    cause,
  });
}

function openChannel(started: Started): Channel {
  const { worker, words } = started;
  let current: TaskRun | undefined;
  let fault: BinferenceError | undefined;
  // The task thread waits on the posted count while its task waits for an answer.
  const wake = (): void => {
    Atomics.add(words, bridgeWords.posted, 1);
    Atomics.notify(words, bridgeWords.posted);
  };
  const fail = (cause: Error["cause"]): void => {
    fault ??= threadFault(started.database, cause);
    current?.fail(fault);
  };
  worker.on("message", (value: WorkerValue) => {
    const message = fromTaskThreadSchema.safeParse(value);
    if (message.success) {
      current?.receive(message.data);
    } else {
      fail(message.error);
      void worker.terminate();
    }
  });
  worker.on("error", fail);
  void started.exited.then(() => fail("the task thread ended"));
  return {
    post: (message) => {
      worker.postMessage(message, []);
      wake();
    },
    abort: (run) => {
      Atomics.store(words, bridgeWords.aborted, run);
      wake();
    },
    serve: (run) => {
      current = run;
    },
    fault: () => fault,
  };
}

function createThread(started: Started): PostgresTaskThread {
  const channel = openChannel(started);
  let runs = 0;
  const queue = createCallQueue(maxWaitingRuns, "store tasks on this Postgres task thread");
  const runNow = async <Schema>(
    job: TaskJob,
    connection: PostgresConnection<Schema>,
    control: RunControl,
  ): Promise<WorkerValue> => {
    control.signal.throwIfAborted();
    const fault = channel.fault();
    if (fault !== undefined) {
      throw fault;
    }
    runs += 1;
    const run = runs;
    const onAbort = (): void => channel.abort(run);
    const taskRun = startTaskRun({ connection, control, post: channel.post });
    channel.serve(taskRun);
    control.signal.addEventListener("abort", onAbort, { once: true });
    try {
      channel.post({ kind: "run", run, ...job });
      return await taskRun.settled;
    } finally {
      control.signal.removeEventListener("abort", onAbort);
      channel.serve(undefined);
    }
  };
  return {
    database: started.database,
    run: async (job, connection, control) =>
      queue.run(async () => runNow(job, connection, control)),
    close: async () => {
      await queue.drained();
      if (channel.fault() === undefined) {
        channel.post({ kind: "stop" });
      }
      await started.exited;
    },
  };
}

// The thread's first message names the database it serves; anything else, an error or an exit
// first is a thread that never served.
function serving(worker: Worker, signal: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const settle = (outcome: () => void): void => {
      worker.off("message", onMessage).off("error", onFailure).off("exit", onFailure);
      signal.removeEventListener("abort", onAbort);
      outcome();
    };
    const onMessage = (value: WorkerValue): void => {
      const parsed = fromTaskThreadSchema.safeParse(value);
      settle(() =>
        parsed.success && parsed.data.kind === "serving"
          ? resolve(parsed.data.database)
          : reject(startFault(parsed.error ?? "its first message was not serving")),
      );
    };
    const onFailure = (cause: Error | number): void => settle(() => reject(startFault(cause)));
    const onAbort = (): void => settle(() => reject(signal.reason));
    worker.on("message", onMessage).on("error", onFailure).on("exit", onFailure);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
  });
}

/**
 * Starts a Postgres task thread on a database's store worker entry (decision 0369) and waits
 * until it serves. Its tasks run there synchronously, each blocking on `Atomics.wait` while this
 * thread runs its statements in the transaction it holds; payloads cross by structured clone, so
 * no result size is bounded by a shared buffer.
 */
export async function startPostgresTaskThread(
  options: PostgresTaskThreadOptions,
): Promise<PostgresTaskThread> {
  const shared = new SharedArrayBuffer(bridgeWords.length * Int32Array.BYTES_PER_ELEMENT);
  const setup: PostgresTaskSetup = {
    kind: "postgres",
    words: shared,
    waitMs: options.waitMs ?? taskWaitMs,
  };
  const worker = new Worker(options.worker, {
    workerData: setup,
    execArgv: [...(options.execArgv ?? [])],
  });
  const exited = new Promise<void>((resolve) => {
    worker.once("exit", () => resolve());
  });
  try {
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(startTimeoutMs)]);
    const database = await serving(worker, signal);
    return createThread({ worker, words: new Int32Array(shared), exited, database });
  } catch (error) {
    await worker.terminate();
    await exited;
    throw error;
  }
}
