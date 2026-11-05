import { BinferenceError } from "@binference/core";
import type { Compilable, CompiledQuery, QueryResult } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPostgresKysely } from "../dialect/kysely-sync.js";
import { failAfterWrite, probeWorker, recordWrite, summarize } from "../testing/probe-database.js";
import type { PostgresConnection } from "./postgres-connection.js";
import { type PostgresTaskThread, startPostgresTaskThread } from "./postgres-task-thread.js";
import type { RunControl } from "./task-run.js";

// The thread runs the TypeScript source, as the store's other worker tests do.
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const schema = "probe_0190f1c23a4b7c5d8e6f000000000001";
const waitMs = 300;

type Answer = (query: CompiledQuery, signal: AbortSignal) => Promise<QueryResult<object>>;

interface Fake<Schema> {
  readonly connection: PostgresConnection<Schema>;
  readonly sent: string[];
}

// A transaction's connection that answers each statement with `answer` and records its SQL.
function fakeConnection<Schema>(control: RunControl, answer: Answer): Fake<Schema> {
  const sent: string[] = [];
  // The thread sends only compiled statements.
  const execute = async <Row>(query: CompiledQuery<Row> | Compilable<Row>) => {
    const compiled = query as CompiledQuery<Row>;
    sent.push(compiled.sql);
    return answer(compiled, control.signal) as Promise<QueryResult<Row>>;
  };
  return {
    connection: {
      kysely: getPostgresKysely<Schema>(schema),
      execute,
      takeFirst: async (query) => (await execute(query)).rows[0],
    },
    sent,
  };
}

function newControl(): RunControl & { readonly caller: AbortController } {
  const caller = new AbortController();
  const stop = new AbortController();
  return { caller, stop, signal: AbortSignal.any([caller.signal, stop.signal]) };
}

// Answers a probe write: the counter at 4, then one row for each write.
const probeAnswers: Answer = async (query) =>
  Promise.resolve(
    query.sql.startsWith("select") ? { rows: [{ value: 4 }] } : { rows: [], numAffectedRows: 1n },
  );

// Answers a probe summary: the writers' rows for the grouped read, one row for the others.
function summaryAnswers(writers: object[]): Answer {
  return async (query) =>
    Promise.resolve({ rows: query.sql.includes("group by") ? writers : [{ count: 1, value: 1 }] });
}

// Answers as a probe write, but refuses each insert with `refused`.
function refusingInserts(refused: Error): Answer {
  return async (query, signal) =>
    query.sql.startsWith("insert") ? Promise.reject(refused) : probeAnswers(query, signal);
}

// Never answers; settles only when the transaction's signal aborts, as Kysely's query does.
const hang: Answer = async (_query, signal) =>
  new Promise((_resolve, reject) => {
    signal.throwIfAborted();
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

const write = { writer: 1, seq: 1 };
const job = { task: recordWrite.name, schema, input: recordWrite.encodeInput(write) };

let thread: PostgresTaskThread;

beforeAll(async () => {
  thread = await startPostgresTaskThread({
    worker: probeWorker,
    execArgv,
    waitMs,
    signal: AbortSignal.timeout(30_000),
  });
});

afterAll(async () => {
  await thread.close();
});

describe("a Postgres task thread", () => {
  it("serves the database its worker entry defines", () => {
    expect(thread.database).toBe("probe");
  });

  it("runs a task's statements in its schema, in order, and returns its output", async () => {
    const run = newControl();
    const fake = fakeConnection(run, probeAnswers);

    await expect(thread.run(job, fake.connection, run)).resolves.toBe(5);
    expect(fake.sent).toStrictEqual([
      `select "value" from "${schema}"."probe_counter" where "id" = $1`,
      `update "${schema}"."probe_counter" set "value" = $1 where "id" = $2`,
      `insert into "${schema}"."probe_writes" ("writer", "seq") values ($1, $2)`,
    ]);
  });

  it("carries a result of many rows whole, with no shared buffer to outgrow", async () => {
    const writers = Array.from({ length: 50_000 }, (_, index) => ({
      writer: index,
      count: 2,
      firstSeq: 0,
      lastSeq: 1,
    }));
    const run = newControl();
    const fake = fakeConnection(run, summaryAnswers(writers));
    const summary = { task: summarize.name, schema, input: summarize.encodeInput(null) };

    const output = await thread.run(summary, fake.connection, run);

    expect(output).toMatchObject({ rows: 100_000, pairs: 1, counter: 1 });
  });

  it("rejects with the failed statement's own error once the task ended", async () => {
    const run = newControl();
    const refused = new Error("duplicate key value violates unique constraint");
    const fake = fakeConnection(run, refusingInserts(refused));

    await expect(thread.run(job, fake.connection, run)).rejects.toBe(refused);
  });

  it("rejects with the task's own fault, as a store worker does", async () => {
    const run = newControl();
    const fake = fakeConnection(run, probeAnswers);
    const failing = { ...job, task: failAfterWrite.name };

    await expect(thread.run(failing, fake.connection, run)).rejects.toMatchObject({
      code: "probe.failed",
    });
  });

  it("wakes a waiting task when the caller aborts, then serves the next run", async () => {
    const run = newControl();
    const fake = fakeConnection(run, async (query, signal) => {
      run.caller.abort(new Error("the caller stopped"));
      return hang(query, signal);
    });

    await expect(thread.run(job, fake.connection, run)).rejects.toThrow("the caller stopped");
    expect(run.stop.signal.aborted).toBe(false);
    const next = newControl();
    await expect(
      thread.run(job, fakeConnection(next, probeAnswers).connection, next),
    ).resolves.toBe(5);
  });

  it("gives up on a statement past its wait bound and stops the transaction", async () => {
    const run = newControl();
    const fake = fakeConnection(run, hang);

    const outcome = thread.run(job, fake.connection, run);

    await expect(outcome).rejects.toMatchObject({
      code: "store.postgres_unreachable",
      details: { waitMs },
    });
    expect(run.stop.signal.reason).toBeInstanceOf(BinferenceError);
  });

  it("refuses a run whose caller aborted before it started, without sending it", async () => {
    const run = newControl();
    const fake = fakeConnection(run, probeAnswers);
    run.caller.abort(new Error("already stopped"));

    await expect(thread.run(job, fake.connection, run)).rejects.toThrow("already stopped");
    expect(fake.sent).toStrictEqual([]);
  });
});
