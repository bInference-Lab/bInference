import { BinferenceError } from "@binference/core";
import type { StoreHost } from "../tasks/store-host.js";
import type { StoreTask } from "../tasks/store-task.js";
import type { WorkerValue } from "../worker/worker-messages.schema.js";
import { createCallQueue } from "./call-queue.js";
import type { PostgresDatabase } from "./open-postgres.js";
import type { PostgresTaskThread } from "./postgres-task-thread.js";

/** What {@link createPostgresStoreHost} binds: one install's schema of one database. */
export interface PostgresStoreHostOptions<Schema> {
  /** The pool the schema's transactions run on. */
  readonly database: PostgresDatabase<Schema>;
  /** The task thread of the schema's database, which may serve other installs too. */
  readonly thread: PostgresTaskThread;
  /** The install's schema, such as `engine_<digits>` (database spec, section 6.2). */
  readonly schema: string;
  /** How long one call may run, its retries included; 30 s by default, as on SQLite. */
  readonly timeoutMs?: number;
}

const taskTimeoutMs = 30_000;
const maxWaitingWrites = 10_000;

function timedOut(cause: Error["cause"]): BinferenceError {
  return new BinferenceError({
    code: "store.timeout",
    message:
      "The store call ran out of time before Postgres finished it, and its transaction rolled back. Read the state before you retry.",
    cause,
  });
}

function badReply(task: string, cause: Error["cause"]): BinferenceError {
  return new BinferenceError({
    code: "store.bad_reply",
    message: `The Postgres task thread's answer to ${task} does not match its schema.`,
    cause,
    details: { what: task },
  });
}

/**
 * A store host on one install's Postgres schema (decision 0369), so a store adapter's tasks run
 * there unchanged. A write task runs in one `SERIALIZABLE` transaction, one at a time in the order
 * the calls came, and runs again from its first statement on a conflict; a read runs in one
 * `REPEATABLE READ` transaction. The caller's signal and the call's time bound abort the
 * transaction where it is: before `COMMIT` it rolls back, during it the call fails
 * `store.commit_unknown`, and a read's statement is cancelled on the server.
 */
export function createPostgresStoreHost<Schema>(
  options: PostgresStoreHostOptions<Schema>,
): StoreHost {
  const { database, thread, schema } = options;
  const writes = createCallQueue(maxWaitingWrites, "store writes on this Postgres schema");
  const call = async <Input, Output>(
    task: StoreTask<Input, Output>,
    input: Input,
    caller: AbortSignal,
  ): Promise<WorkerValue> => {
    const job = { task: task.name, schema, input: task.encodeInput(input) };
    const stop = new AbortController();
    const deadline = AbortSignal.timeout(options.timeoutMs ?? taskTimeoutMs);
    const signal = AbortSignal.any([caller, stop.signal, deadline]);
    const control = { signal, stop };
    try {
      return task.access === "write"
        ? await writes.run(async () =>
            database.write(async (connection) => thread.run(job, connection, control), signal),
          )
        : await database.read(async (connection) => thread.run(job, connection, control), signal);
    } catch (error) {
      throw deadline.aborted && error === deadline.reason ? timedOut(error) : error;
    }
  };
  return {
    run: async (task, input, { signal }) => {
      signal.throwIfAborted();
      const value = await call(task, input, signal);
      const parsed = task.output.safeParse(value);
      if (!parsed.success) {
        throw badReply(task.name, parsed.error);
      }
      return parsed.data;
    },
  };
}
