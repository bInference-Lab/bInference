import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import {
  bridgeWords,
  type EndedMessage,
  type FromTaskThread,
  fromTaskThreadSchema,
  type PostgresTaskSetup,
  type StatementMessage,
  type ToTaskThread,
} from "../postgres/task-bridge-messages.js";
import { probeWorker, recordWrite } from "../testing/probe-database.js";

// The worker runs the TypeScript source, as the store's other worker tests do.
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const schema = "probe_0190f1c23a4b7c5d8e6f000000000001";
const write = recordWrite.encodeInput({ writer: 1, seq: 1 });

/** The statement side played by hand: it sees each message and answers as a test tells it. */
interface HandSide {
  readonly words: Int32Array;
  next(): Promise<FromTaskThread>;
  post(message: ToTaskThread): void;
}

const started: Worker[] = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map(async (worker) => worker.terminate()));
});

async function startTasks(waitMs: number): Promise<HandSide> {
  const shared = new SharedArrayBuffer(bridgeWords.length * Int32Array.BYTES_PER_ELEMENT);
  const setup: PostgresTaskSetup = { kind: "postgres", words: shared, waitMs };
  const worker = new Worker(probeWorker, { workerData: setup, execArgv });
  started.push(worker);
  const waiting: FromTaskThread[] = [];
  const takers: ((message: FromTaskThread) => void)[] = [];
  worker.on("message", (value: object) => {
    const message = fromTaskThreadSchema.parse(value);
    const taker = takers.shift();
    if (taker === undefined) {
      waiting.push(message);
    } else {
      taker(message);
    }
  });
  const words = new Int32Array(shared);
  const side: HandSide = {
    words,
    next: async () => {
      const ready = waiting.shift();
      return ready ?? new Promise((resolve) => takers.push(resolve));
    },
    post: (message) => {
      worker.postMessage(message, []);
      Atomics.add(words, bridgeWords.posted, 1);
      Atomics.notify(words, bridgeWords.posted);
    },
  };
  await expect(side.next()).resolves.toStrictEqual({ kind: "serving", database: "probe" });
  return side;
}

async function nextStatement(side: HandSide): Promise<StatementMessage> {
  const message = await side.next();
  expect(message.kind).toBe("statement");
  return message as StatementMessage;
}

function rows(statement: number, value: number): ToTaskThread {
  return { kind: "result", statement, ok: true, rows: [{ value }] };
}

const affected = (statement: number): ToTaskThread => ({
  kind: "result",
  statement,
  ok: true,
  rows: [],
  numAffectedRows: 1n,
});

describe("serving store tasks for Postgres", () => {
  it("runs a task's statements in the run's schema and ends with its output", async () => {
    const side = await startTasks(5_000);
    side.post({ kind: "run", run: 1, task: recordWrite.name, schema, input: write });

    const read = await nextStatement(side);
    expect(read).toStrictEqual({
      kind: "statement",
      statement: 1,
      sql: `select "value" from "${schema}"."probe_counter" where "id" = $1`,
      parameters: [1],
    });
    side.post(rows(1, 41));
    side.post(affected((await nextStatement(side)).statement));
    side.post(affected((await nextStatement(side)).statement));

    await expect(side.next()).resolves.toStrictEqual({
      kind: "ended",
      run: 1,
      ok: true,
      value: 42,
    } satisfies EndedMessage);
  });

  it("drops an answer to an earlier statement and waits for its own", async () => {
    const side = await startTasks(5_000);
    side.post({ kind: "run", run: 1, task: recordWrite.name, schema, input: write });
    const read = await nextStatement(side);

    side.post(rows(read.statement - 1, 7));
    side.post(rows(read.statement, 9));
    side.post(affected((await nextStatement(side)).statement));
    side.post(affected((await nextStatement(side)).statement));

    await expect(side.next()).resolves.toMatchObject({ kind: "ended", ok: true, value: 10 });
  });

  it("stops a task when its own run is marked aborted, not an earlier run", async () => {
    const side = await startTasks(5_000);
    Atomics.store(side.words, bridgeWords.aborted, 1);
    side.post({ kind: "run", run: 2, task: recordWrite.name, schema, input: write });
    const read = await nextStatement(side);

    Atomics.store(side.words, bridgeWords.aborted, 2);
    side.post({ kind: "result", statement: read.statement + 1, ok: false });

    await expect(side.next()).resolves.toMatchObject({
      kind: "ended",
      run: 2,
      ok: false,
      error: { code: "store.aborted" },
    });
  });

  it("gives up on a statement left unanswered past the wait bound", async () => {
    const side = await startTasks(200);
    side.post({ kind: "run", run: 1, task: recordWrite.name, schema, input: write });
    await nextStatement(side);

    await expect(side.next()).resolves.toMatchObject({
      kind: "ended",
      ok: false,
      error: { code: "store.postgres_unreachable", retryable: true, details: { waitMs: 200 } },
    });
  });

  it("ends a run of a task the database does not list with its fault", async () => {
    const side = await startTasks(5_000);
    side.post({ kind: "run", run: 1, task: "probe.missing", schema, input: null });

    await expect(side.next()).resolves.toMatchObject({
      kind: "ended",
      ok: false,
      error: { code: "store.unknown_task" },
    });
  });
});
