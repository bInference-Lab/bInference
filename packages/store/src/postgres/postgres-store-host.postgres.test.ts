import { type Clock } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { sql } from "kysely";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { okValue } from "../contracts/agent-fixtures.js";
import { workerIdSchema } from "../leases/agent-leases.js";
import { prepareSharedSchema } from "../migrations/prepare-shared-schema.js";
import type { MetaTables } from "../migrations/run-postgres-migrations.js";
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
import { createProbeInstall } from "../testing/probe-install.js";
import { createTestPostgresDatabase, type TestPostgresDatabase } from "../testing/test-postgres.js";
import type { StoreLease } from "./lease-fence.js";
import { openPostgres, type PostgresDatabase } from "./open-postgres.js";
import { poolConfigOf } from "./pool-config.js";
import { createPostgresAgentLeases } from "./postgres-agent-leases.js";
import { createPostgresStoreHost } from "./postgres-store-host.js";
import { type PostgresTaskThread, startPostgresTaskThread } from "./postgres-task-thread.js";

const url = inject("postgres");
const never = new AbortController().signal;
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const sharedSchema = "shared";
const sleeping = 'select pg_sleep($1) as "slept"';

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
  let schema: string;
  let lease: StoreLease;

  const summary = async (): Promise<unknown> => host.run(summarize, null, { signal: never });

  beforeAll(async () => {
    server = await createTestPostgresDatabase(url);
    database = await openPostgres<MetaTables>(server.settings, {
      clock,
      random: createSeededRandom(5),
      logger,
      signal: never,
    });
    await prepareSharedSchema(database, sharedSchema, never);
    const probe = await createProbeInstall(database, { sharedSchema, n: 1 }, never);
    schema = probe.schema;
    // Nothing renews it, so it outlasts the file.
    const leases = createPostgresAgentLeases({ database, sharedSchema, leaseMs: 3_600_000 });
    const take = { installId: probe.installId, workerId: workerIdSchema.parse("probe-worker") };
    lease = { sharedSchema, held: okValue(await leases.take(take, { signal: never })) };
    const start = { worker: probeWorker, execArgv, signal: AbortSignal.timeout(30_000) };
    thread = await startPostgresTaskThread(start);
    quick = await startPostgresTaskThread({ ...start, waitMs: 300 });
    host = createPostgresStoreHost({ database, thread, schema, lease });
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
    // The write's lease check takes its snapshot, and the task's first statement then lock 7;
    // committing after it makes the task's update of the counter fail with 40001.
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
    const bounded = createPostgresStoreHost({ database, thread: quick, schema, lease });
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
    const bounded = createPostgresStoreHost({ database, thread, schema, lease, timeoutMs: 300 });
    await expect(
      bounded.run(recordThenSleep, { writer: 5, seq: 1 }, { signal: never }),
    ).rejects.toMatchObject({ code: "store.timeout" });
    await untilStatement(database, sleeping, "ended");
    await expect(summary()).resolves.toMatchObject({ rows: 3, counter: 103 });
  });
});
