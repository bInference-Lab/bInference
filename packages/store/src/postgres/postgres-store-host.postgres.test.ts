import { type Clock } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { sql } from "kysely";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { MetaTables } from "../migrations/run-postgres-migrations.js";
import { runPostgresMigrations } from "../migrations/run-postgres-migrations.js";
import type { StoreHost } from "../tasks/store-host.js";
import {
  failAfterWrite,
  probeWorker,
  recordAfterLock,
  recordThenSleep,
  recordWrite,
  sleepOnServer,
  summarize,
} from "../testing/probe-database.js";
import { createTestPostgresDatabase, type TestPostgresDatabase } from "../testing/test-postgres.js";
import { openPostgres, type PostgresDatabase } from "./open-postgres.js";
import { poolConfigOf } from "./pool-config.js";
import { createPostgresStoreHost } from "./postgres-store-host.js";
import { type PostgresTaskThread, startPostgresTaskThread } from "./postgres-task-thread.js";

const url = inject("postgres");
const never = new AbortController().signal;
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const schema = "probe_0190f1c23a4b7c5d8e6f000000000001";
const sleeping = 'select pg_sleep($1) as "slept"';

// The probe database's tables in their Postgres form, for the bridge's own tests.
const probePlan = {
  name: "probe",
  migrations: [
    {
      name: "0001_meta",
      sql: 'create table meta (key text collate "C" primary key, value text collate "C" not null)',
    },
    {
      name: "0002_probe_tables",
      sql: `create table probe_writes (id bigserial primary key, writer bigint not null,
          seq bigint not null, unique (writer, seq));
        create table probe_counter (id bigint primary key, value bigint not null);
        insert into probe_counter values (1, 0);`,
    },
  ],
};

const clock: Clock = { now: () => 0, sleep: async () => Promise.resolve() };

// Waits on the server, up to five seconds, until a statement of this text runs or no longer does.
async function untilStatement(
  database: PostgresDatabase<MetaTables>,
  text: string,
  until: "running" | "ended",
): Promise<void> {
  await database.read(async ({ kysely, execute }) => {
    await execute(
      sql`do $$ declare stop timestamptz := clock_timestamp() + interval '5 seconds'; begin
        loop perform pg_stat_clear_snapshot();
          exit when clock_timestamp() > stop or ${sql.lit(until === "running")} = exists (select
            from pg_catalog.pg_stat_activity where query = ${sql.lit(text)} and state = 'active');
          perform pg_sleep(0.01); end loop; end $$`.compile(kysely),
    );
  }, never);
}

describe.runIf(url !== "")("a store host on Postgres", () => {
  const logger = createMemoryLogger({ subsystem: "store" });
  let server: TestPostgresDatabase;
  let database: PostgresDatabase<MetaTables>;
  let thread: PostgresTaskThread;
  let quick: PostgresTaskThread;
  let host: StoreHost;

  const summary = async (): Promise<unknown> => host.run(summarize, null, { signal: never });

  beforeAll(async () => {
    server = await createTestPostgresDatabase(url);
    database = await openPostgres<MetaTables>(server.settings, {
      clock,
      random: createSeededRandom(5),
      logger,
      signal: never,
    });
    await runPostgresMigrations(database, { schema, plan: probePlan }, never);
    const start = { worker: probeWorker, execArgv, signal: AbortSignal.timeout(30_000) };
    thread = await startPostgresTaskThread(start);
    quick = await startPostgresTaskThread({ ...start, waitMs: 300 });
    host = createPostgresStoreHost({ database, thread, schema });
  });

  afterAll(async () => {
    await Promise.all([thread.close(), quick.close()]);
    await database.close();
    await server.drop();
  });

  it("writes in one transaction and reads what committed", async () => {
    await expect(host.run(recordWrite, { writer: 1, seq: 1 }, { signal: never })).resolves.toBe(1);
    await expect(host.run(recordWrite, { writer: 1, seq: 2 }, { signal: never })).resolves.toBe(2);
    await expect(summary()).resolves.toMatchObject({ rows: 2, pairs: 2, counter: 2 });
  });

  it("rolls a task back whole when it throws, with its own fault", async () => {
    await expect(
      host.run(failAfterWrite, { writer: 2, seq: 1 }, { signal: never }),
    ).rejects.toMatchObject({ code: "probe.failed" });
    await expect(summary()).resolves.toMatchObject({ rows: 2, counter: 2 });
  });

  it("fails a broken unique key as a constraint and keeps nothing of the task", async () => {
    await expect(
      host.run(recordWrite, { writer: 1, seq: 1 }, { signal: never }),
    ).rejects.toMatchObject({ code: "store.constraint", details: { sqlState: "23505" } });
    await expect(summary()).resolves.toMatchObject({ rows: 2, counter: 2 });
  });

  it("runs a write task again from its first statement after a serialization failure", async () => {
    const other = new Client(poolConfigOf(server.settings));
    await other.connect();
    await other.query("begin");
    await other.query(`update "${schema}".probe_counter set value = value + 100 where id = 1`);
    const writing = host.run(recordAfterLock, { writer: 3, seq: 1 }, { signal: never });
    // The task's first statement takes its snapshot and lock 7; committing after it makes the
    // task's update of the counter fail with 40001.
    await other.query(`do $$ begin loop perform pg_stat_clear_snapshot();
      exit when exists (select from pg_catalog.pg_locks where locktype = 'advisory'
        and objid = 7 and granted); perform pg_sleep(0.01); end loop; end $$`);
    await other.query("commit");
    await other.end();
    await expect(writing).resolves.toBe(103);
    expect(logger.records().map((record) => record.event)).toContain("store.write_retried");
  });

  it("cancels a read's statement on the server when the caller aborts", async () => {
    const stop = new AbortController();
    const reading = host.run(sleepOnServer, 30, { signal: stop.signal });
    await untilStatement(database, sleeping, "running");
    stop.abort(new Error("stopped"));
    await expect(reading).rejects.toThrow("stopped");
    await untilStatement(database, sleeping, "ended");
    await expect(summary()).resolves.toMatchObject({ rows: 3 });
  });

  it("rolls a write back when the caller aborts while its statement runs", async () => {
    const stop = new AbortController();
    const writing = host.run(recordThenSleep, { writer: 4, seq: 1 }, { signal: stop.signal });
    await untilStatement(database, sleeping, "running");
    stop.abort(new Error("stopped"));
    await expect(writing).rejects.toThrow("stopped");
    await untilStatement(database, sleeping, "ended");
    await expect(summary()).resolves.toMatchObject({ rows: 3, counter: 103 });
  });

  it("stops a statement Postgres leaves unanswered past the task's wait bound", async () => {
    const bounded = createPostgresStoreHost({ database, thread: quick, schema });
    await expect(bounded.run(sleepOnServer, 30, { signal: never })).rejects.toMatchObject({
      code: "store.postgres_unreachable",
      details: { waitMs: 300 },
    });
    await untilStatement(database, sleeping, "ended");
    await expect(bounded.run(summarize, null, { signal: never })).resolves.toMatchObject({
      rows: 3,
    });
  });

  it("fails a call past its time bound as a time-out and rolls it back", async () => {
    const bounded = createPostgresStoreHost({ database, thread, schema, timeoutMs: 300 });
    await expect(
      bounded.run(recordThenSleep, { writer: 5, seq: 1 }, { signal: never }),
    ).rejects.toMatchObject({ code: "store.timeout" });
    await untilStatement(database, sleeping, "ended");
    await expect(summary()).resolves.toMatchObject({ rows: 3, counter: 103 });
  });
});
