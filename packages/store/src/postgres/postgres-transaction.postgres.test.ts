import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createTestPostgresDatabase, type TestPostgresDatabase } from "../testing/test-postgres.js";
import { openPostgres, type PostgresDatabase } from "./open-postgres.js";
import { poolConfigOf } from "./pool-config.js";
import type { PostgresSettings } from "./postgres-settings.js";
import { postgresRead } from "./postgres-transaction.js";

const url = inject("postgres");
const never = new AbortController().signal;
const short = "select pg_sleep(0.2)";
const next = "select pg_sleep(0.5) as done";

// Waits on the server, up to five seconds, until the condition holds.
async function waitOnServer(watcher: PostgresDatabase<object>, condition: string): Promise<void> {
  await watcher.read(async ({ kysely, execute }) => {
    await execute(
      sql`do $$ declare deadline timestamptz := clock_timestamp() + interval '5 seconds'; begin
        while not (${sql.raw(condition)}) and clock_timestamp() < deadline loop
          perform pg_sleep(0.01); perform pg_stat_clear_snapshot(); end loop; end $$`.compile(
        kysely,
      ),
    );
  }, never);
}

function active(statement: string): string {
  return `exists (select from pg_catalog.pg_stat_activity where query = '${statement}' and state = 'active')`;
}

async function cancelOnServer(settings: PostgresSettings, processId: number): Promise<void> {
  const client = new Client(poolConfigOf(settings));
  await client.connect();
  try {
    await client.query("select pg_cancel_backend($1)", [processId]);
  } finally {
    await client.end();
  }
}

describe.runIf(url !== "")("a Postgres read's cancel", () => {
  let server: TestPostgresDatabase;
  let watcher: PostgresDatabase<object>;
  let single: Kysely<object>;

  beforeAll(async () => {
    server = await createTestPostgresDatabase(url);
    watcher = await openPostgres<object>(server.settings, {
      clock: { now: () => 0, sleep: async () => Promise.resolve() },
      random: createSeededRandom(11),
      logger: createMemoryLogger({ subsystem: "store" }),
      signal: never,
    });
    const pool = new Pool(poolConfigOf({ ...server.settings, maxConnections: 1 }));
    single = new Kysely<object>({ dialect: new PostgresDialect({ pool }) });
  });

  afterAll(async () => {
    await single.destroy();
    await watcher.close();
    await server.drop();
  });

  it("holds the connection until the cancel ended, so it never reaches the next call's statement", async () => {
    // The cancel lands only once the next read runs or this read's connection sits idle in its
    // transaction: a connection let go too early would carry the cancel to the next read.
    const cancel = async (processId: number): Promise<void> => {
      await waitOnServer(
        watcher,
        `${active(next)} or exists (select from pg_catalog.pg_stat_activity
          where pid = ${String(processId)} and state = 'idle in transaction')`,
      );
      await cancelOnServer(server.settings, processId);
    };
    const stop = new AbortController();
    const aborted = postgresRead(
      single,
      async ({ kysely, execute }) => execute(sql.raw(short).compile(kysely)),
      { signal: stop.signal, cancel },
    );
    await waitOnServer(watcher, active(short));
    stop.abort(new Error("stopped"));
    const after = postgresRead(
      single,
      async ({ kysely, takeFirst }) =>
        takeFirst(sql<{ done: string }>`${sql.raw(next)}`.compile(kysely)),
      { signal: never, cancel },
    );
    await expect(aborted).rejects.toThrow("stopped");
    await expect(after).resolves.toStrictEqual({ done: "" });
  });

  it("lets the statement run to its end when the cancel cannot reach the server", async () => {
    const stop = new AbortController();
    const reading = postgresRead(
      single,
      async ({ kysely, execute }) => execute(sql.raw(short).compile(kysely)),
      { signal: stop.signal, cancel: async () => Promise.resolve() },
    );
    await waitOnServer(watcher, active(short));
    stop.abort(new Error("stopped"));
    await expect(reading).rejects.toThrow("stopped");
    await waitOnServer(watcher, `not ${active(short)}`);
    const row = await postgresRead(
      single,
      async ({ kysely, takeFirst }) =>
        takeFirst(sql<{ ok: number }>`select 1 as ok`.compile(kysely)),
      { signal: never, cancel: async () => Promise.resolve() },
    );
    expect(row).toStrictEqual({ ok: 1 });
  });
});
