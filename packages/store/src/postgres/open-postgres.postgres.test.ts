import { BinferenceError, type Clock } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { sql } from "kysely";
import { DatabaseError } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createTestPostgresDatabase, type TestPostgresDatabase } from "../testing/test-postgres.js";
import { openPostgres, type PostgresDatabase } from "./open-postgres.js";

interface Tables {
  "t.items": { k: number; v: number };
}

const url = inject("postgres");
const never = new AbortController().signal;

function recordingClock(waits: number[]): Clock {
  return {
    now: () => 0,
    sleep: async (delayMs) => {
      waits.push(delayMs);
      await Promise.resolve();
    },
  };
}

function conflict(): DatabaseError {
  const error = new DatabaseError("could not serialize access", 0, "error");
  error.code = "40001";
  return error;
}

function ignore(): void {
  // Replaced before anything calls it.
}

// The first `parties` callers wait until all of them arrived; later callers pass at once.
function createGate(parties: number): () => Promise<void> {
  let arrived = 0;
  let open: () => void = ignore;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === parties) {
      open();
    }
    return arrived <= parties ? opened : undefined;
  };
}

// Counts the rows, waits at the gate, then adds a row keyed by the count: two of these run
// together read the same count, so one must lose and run again.
async function addNext(database: PostgresDatabase<Tables>, gate: () => Promise<void>) {
  return database.write(async ({ kysely, takeFirst, execute }) => {
    const counted = await takeFirst(
      kysely.selectFrom("t.items").select((row) => row.fn.countAll<string>().as("n")),
    );
    await gate();
    const next = Number(counted?.n) + 100;
    await execute(kysely.insertInto("t.items").values({ k: next, v: next }));
    return next;
  }, never);
}

// Waits on the server, up to five seconds, until a statement shows in pg_stat_activity or leaves it.
async function waitForStatement(
  database: PostgresDatabase<Tables>,
  statement: string,
  until: "running" | "ended",
): Promise<void> {
  const running = until === "running";
  await database.read(async ({ kysely, execute }) => {
    await execute(
      sql`do $$ declare deadline timestamptz := clock_timestamp() + interval '5 seconds'; begin
        while (exists (select from pg_catalog.pg_stat_activity
            where query = ${sql.lit(statement)} and state = 'active')) <> ${sql.lit(running)}
          and clock_timestamp() < deadline loop perform pg_sleep(0.01); perform pg_stat_clear_snapshot(); end loop; end $$`.compile(
        kysely,
      ),
    );
  }, never);
}

// The base of each wait, when the wait is its base plus less than half more; else the wait.
function jitteredWaits(waits: readonly number[]): readonly number[] {
  const bases = [10, 40, 160];
  return waits.map((wait, index) => {
    const base = bases[index] ?? 0;
    return wait >= base && wait < base * 1.5 ? base : wait;
  });
}

async function keyStored(database: PostgresDatabase<Tables>, k: number): Promise<boolean> {
  const row = await database.read(
    async ({ kysely, takeFirst }) =>
      takeFirst(kysely.selectFrom("t.items").select("k").where("k", "=", k)),
    never,
  );
  return row !== undefined;
}

describe.runIf(url !== "")("a Postgres store connection", () => {
  const logger = createMemoryLogger({ subsystem: "store" });
  const waits: number[] = [];
  let server: TestPostgresDatabase;
  let database: PostgresDatabase<Tables>;

  beforeAll(async () => {
    server = await createTestPostgresDatabase(url);
    database = await openPostgres<Tables>(server.settings, {
      clock: recordingClock(waits),
      random: createSeededRandom(7),
      logger,
      signal: never,
    });
    await database.write(async ({ kysely, execute }) => {
      await execute(sql`create schema t`.compile(kysely));
      await execute(sql`create table t.items (k int primary key, v int not null)`.compile(kysely));
      await execute(
        sql`create function t.slow_commit() returns trigger language plpgsql as $$
          begin perform pg_sleep(0.5); return null; end $$`.compile(kysely),
      );
      await execute(
        sql`create constraint trigger slow after insert on t.items deferrable initially deferred
          for each row when (new.k = 3) execute function t.slow_commit()`.compile(kysely),
      );
    }, never);
  });

  afterAll(async () => {
    await database.close();
    await server.drop();
  });

  it("starts each session with the store's settings", async () => {
    const row = await database.read(
      async ({ kysely, takeFirst }) =>
        takeFirst(
          sql<Record<string, string>>`select current_setting('statement_timeout') as statement,
            current_setting('lock_timeout') as lock,
            current_setting('idle_in_transaction_session_timeout') as idle,
            current_setting('TimeZone') as zone, current_setting('search_path') as path,
            current_setting('application_name') as app`.compile(kysely),
        ),
      never,
    );
    expect(row).toStrictEqual({
      statement: "5s",
      lock: "2s",
      idle: "2s",
      zone: "UTC",
      path: "",
      app: "binference-test",
    });
  });

  it("reads integers as numbers and numeric as its decimal text", async () => {
    const row = await database.read(
      async ({ kysely, takeFirst }) =>
        takeFirst(
          sql<Record<string, number | string>>`select 9007199254740991::int8 as big,
            7::int2 as small, (-5)::int4 as plain,
            ${sql.lit("1".repeat(78))}::numeric(78,0) as amount`.compile(kysely),
        ),
      never,
    );
    expect(row).toStrictEqual({
      big: 9_007_199_254_740_991,
      small: 7,
      plain: -5,
      amount: "1".repeat(78),
    });
  });

  it("refuses an integer past what a number holds exactly", async () => {
    await expect(
      database.read(
        async ({ kysely, execute }) =>
          execute(sql`select 9007199254740992::int8 as big`.compile(kysely)),
        never,
      ),
    ).rejects.toMatchObject({ code: "store.integer_too_large" });
  });

  it("writes at serializable and reads at repeatable read, read only", async () => {
    const levelOf = sql<{ level: string; readOnly: string }>`select
      current_setting('transaction_isolation') as level,
      current_setting('transaction_read_only') as "readOnly"`;
    const write = await database.write(
      async ({ kysely, takeFirst }) => takeFirst(levelOf.compile(kysely)),
      never,
    );
    const read = await database.read(
      async ({ kysely, takeFirst }) => takeFirst(levelOf.compile(kysely)),
      never,
    );
    expect([write, read]).toStrictEqual([
      { level: "serializable", readOnly: "off" },
      { level: "repeatable read", readOnly: "on" },
    ]);
  });

  it("runs a write again from its first read after a serialization failure", async () => {
    const gate = createGate(2);
    const keys = await Promise.all([addNext(database, gate), addNext(database, gate)]);
    expect(keys.toSorted()).toStrictEqual([100, 101]);
    expect(logger.records().map((record) => record.event)).toContain("store.write_retried");
  });

  it("gives up after three retries with store write conflict", async () => {
    waits.length = 0;
    let attempts = 0;
    await expect(
      database.write(async () => {
        attempts += 1;
        await Promise.resolve();
        throw conflict();
      }, never),
    ).rejects.toMatchObject({ code: "store.write_conflict", details: { attempts: 4 } });
    expect(attempts).toBe(4);
    expect(jitteredWaits(waits)).toStrictEqual([10, 40, 160]);
    expect(waits).toHaveLength(3);
  });

  it("never retries another failure", async () => {
    let attempts = 0;
    await expect(
      database.write(async ({ kysely, execute }) => {
        attempts += 1;
        await execute(kysely.insertInto("t.items").values({ k: 1, v: 1 }));
        await execute(kysely.insertInto("t.items").values({ k: 1, v: 2 }));
      }, never),
    ).rejects.toMatchObject({ code: "store.constraint", details: { sqlState: "23505" } });
    expect(attempts).toBe(1);
  });

  it("rolls a write back when its signal aborts before the commit", async () => {
    const stop = new AbortController();
    await expect(
      database.write(async ({ kysely, execute }) => {
        await execute(kysely.insertInto("t.items").values({ k: 2, v: 2 }));
        stop.abort(new BinferenceError({ code: "test.stopped", message: "Stopped." }));
      }, stop.signal),
    ).rejects.toMatchObject({ code: "test.stopped" });
    await expect(keyStored(database, 2)).resolves.toBe(false);
  });

  it("calls a write whose commit an abort interrupted unknown, though it may land", async () => {
    const stop = new AbortController();
    const writing = database.write(async ({ kysely, execute }) => {
      await execute(kysely.insertInto("t.items").values({ k: 3, v: 3 }));
    }, stop.signal);
    // Row 3's deferred trigger holds its COMMIT for half a second.
    await waitForStatement(database, "commit", "running");
    stop.abort(new Error("stopped"));
    await expect(writing).rejects.toMatchObject({ code: "store.commit_unknown" });
    await waitForStatement(database, "commit", "ended");
    await expect(keyStored(database, 3)).resolves.toBe(true);
  });

  it("cancels a read's query on the server when its signal aborts", async () => {
    const stop = new AbortController();
    const reading = database.read(
      async ({ kysely, execute }) => execute(sql`select pg_sleep(30)`.compile(kysely)),
      stop.signal,
    );
    await waitForStatement(database, "select pg_sleep(30)", "running");
    stop.abort(new Error("stopped"));
    await expect(reading).rejects.toThrow("stopped");
    await waitForStatement(database, "select pg_sleep(30)", "ended");
    const sleeping = await database.read(
      async ({ kysely, takeFirst }) =>
        takeFirst(
          sql<{ n: number }>`select count(*)::int as n from pg_catalog.pg_stat_activity
            where query = 'select pg_sleep(30)' and state = 'active'`.compile(kysely),
        ),
      never,
    );
    expect(sleeping).toStrictEqual({ n: 0 });
  });
});
