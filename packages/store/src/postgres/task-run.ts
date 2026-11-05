import { BinferenceError } from "@binference/core";
import { CompiledQuery, type QueryResult } from "kysely";
import type { WorkerValue } from "../worker/worker-messages.schema.js";
import type { PostgresConnection } from "./postgres-connection.js";
import type {
  EndedMessage,
  FromTaskThread,
  ResultMessage,
  StatementMessage,
  ToTaskThread,
} from "./task-bridge-messages.js";

/** How a run follows its transaction. */
export interface RunControl {
  /** The transaction's signal: when it aborts, the task stops where it waits. */
  readonly signal: AbortSignal;
  /** Aborted with the task's fault when the task gives up on a running statement. */
  readonly stop: AbortController;
}

/** What one run's statement side works with. */
export interface RunSide<Schema> {
  readonly connection: PostgresConnection<Schema>;
  readonly control: RunControl;
  /** Sends a message to the task thread and wakes it. */
  readonly post: (message: ToTaskThread) => void;
}

/** One run on the statement side. */
export interface TaskRun {
  /** Takes a message the task thread sent during the run. */
  receive(message: FromTaskThread): void;
  /** Ends the run with a fault, such as the task thread stopping. */
  fail(fault: BinferenceError): void;
  /**
   * The task's encoded output once it ended and no statement of it still runs; else the
   * signal's reason, the first failed statement's error, or the task's own fault, in that order.
   */
  readonly settled: Promise<WorkerValue>;
}

type Row = Readonly<Record<string, WorkerValue>>;

/** A failed statement's error, boxed so that any thrown value, `undefined` too, is kept. */
interface Failure {
  readonly error: Error["cause"];
}

function answerOf(statement: number, result: QueryResult<Row>): ResultMessage {
  const { rows, numAffectedRows } = result;
  return numAffectedRows === undefined
    ? { kind: "result", statement, ok: true, rows }
    : { kind: "result", statement, ok: true, rows, numAffectedRows };
}

// Runs one statement in the run's transaction and answers the task thread; returns the error
// of a statement that failed.
async function runStatement<Schema>(
  side: RunSide<Schema>,
  message: StatementMessage,
): Promise<Failure | undefined> {
  const query: CompiledQuery<Row> = CompiledQuery.raw(message.sql, [...message.parameters]);
  try {
    side.post(answerOf(message.statement, await side.connection.execute(query)));
    return undefined;
  } catch (error) {
    side.post({ kind: "result", statement: message.statement, ok: false });
    return { error };
  }
}

function outcome(
  ended: EndedMessage,
  failure: Failure | undefined,
  signal: AbortSignal,
): Promise<WorkerValue> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  if (failure !== undefined) {
    return Promise.reject(failure.error);
  }
  return ended.ok ? Promise.resolve(ended.value) : Promise.reject(new BinferenceError(ended.error));
}

function ignore(): void {
  // Replaced before anything calls it.
}

/** Starts the statement side of one run (decision 0369). */
export function startTaskRun<Schema>(side: RunSide<Schema>): TaskRun {
  const { signal, stop } = side.control;
  let running = 0;
  let failure: Failure | undefined;
  let ended: EndedMessage | undefined;
  let resolveRun: (value: Promise<WorkerValue>) => void = ignore;
  const settled = new Promise<WorkerValue>((resolve) => {
    resolveRun = resolve;
  });
  // A run settles once; its outcome is made only then, so no rejection is left without a reader.
  let done = false;
  const finish = (make: () => Promise<WorkerValue>): void => {
    if (!done) {
      done = true;
      resolveRun(make());
    }
  };
  const settle = (): void => {
    if (ended !== undefined && running === 0) {
      const last = ended;
      finish(async () => outcome(last, failure, signal));
    }
  };
  const execute = async (message: StatementMessage): Promise<void> => {
    // After an abort or a failed statement the transaction is lost: refuse without the server.
    if (signal.aborted || failure !== undefined) {
      side.post({ kind: "result", statement: message.statement, ok: false });
      return;
    }
    running += 1;
    failure ??= await runStatement(side, message);
    running -= 1;
    settle();
  };
  return {
    receive(message) {
      if (message.kind === "statement") {
        void execute(message);
      } else if (message.kind === "ended") {
        ended = message;
        // The task gave up while a statement runs: aborting the transaction stops it on the
        // server (a read cancels it by process id) before the transaction ends.
        if (!message.ok && running > 0 && !signal.aborted) {
          stop.abort(new BinferenceError(message.error));
        }
        settle();
      }
    },
    fail: (fault) => finish(async () => Promise.reject(fault)),
    settled,
  };
}
