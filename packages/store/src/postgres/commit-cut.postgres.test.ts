import { randomBytes } from "node:crypto";
import type { BinferenceError, Clock } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { sql } from "kysely";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { type CommitCutProxy, startCommitCutProxy } from "../testing/commit-cut-proxy.js";
import { createTestPostgresDatabase, type TestPostgresDatabase } from "../testing/test-postgres.js";
import { createCommitStatus } from "./commit-status.js";
import type { CommitIdentity } from "./commit-step.js";
import { openPostgres, type PostgresDatabase } from "./open-postgres.js";
import { poolConfigOf } from "./pool-config.js";
import type { PostgresConnection } from "./postgres-connection.js";
import type { PostgresSettings } from "./postgres-settings.js";

const url = inject("postgres");
const never = new AbortController().signal;
// Waits pass their time on the clock at once, so a check's 3 s and 10 s pass in the few real
// milliseconds its asks take: well inside the server's 2 s idle timeout, unless a test waits it out.
function advancingClock(): Clock {
  let nowMs = 0;
  return {
    now: () => nowMs,
    sleep: async (delayMs) => {
      nowMs += delayMs;
      await Promise.resolve();
    },
  };
}

interface Tables {
  readonly "cut.rows": { readonly id: number };
}

/** How many times a write's work ran. */
interface Runs {
  add(): void;
  readonly count: () => number;
}

function counter(): Runs {
  let count = 0;
  return {
    add: () => {
      count += 1;
    },
    count: () => count,
  };
}

// A write a COMMIT cut happens to, as the proxy cuts it: each run inserts the row and counts.
function inserting(id: number, runs: Runs) {
  return async ({ kysely, execute }: PostgresConnection<Tables>): Promise<number> => {
    runs.add();
    await execute(kysely.insertInto("cut.rows").values({ id }));
    return id;
  };
}

// A session of its own, in a transaction that took an id, and what a write would ask about it.
async function openSession(
  settings: PostgresSettings,
): Promise<{ readonly client: Client; readonly identity: CommitIdentity }> {
  const client = new Client(poolConfigOf(settings));
  // A session a test ends fails its next query; the client tells it again, and nothing listens.
  client.on("error", () => undefined);
  await client.connect();
  await client.query("begin");
  const { rows } = await client.query<{
    readonly transaction_id: string;
    readonly process_id: number;
    readonly session_start: string;
    readonly server_start: string;
  }>(`select pg_current_xact_id()::text as transaction_id, pg_backend_pid() as process_id,
    (select backend_start::text from pg_stat_activity where pid = pg_backend_pid()) as session_start,
    pg_postmaster_start_time()::text as server_start`);
  const [row] = rows;
  return {
    client,
    identity: {
      transactionId: row?.transaction_id ?? "",
      processId: row?.process_id ?? 0,
      sessionStart: row?.session_start ?? "",
      serverStart: row?.server_start ?? "",
    },
  };
}

// The id the session's open transaction takes, as a write's first change gives it one.
async function transactionIdOf(client: Client): Promise<string> {
  const { rows } = await client.query<{ readonly id: string }>(
    "select pg_current_xact_id()::text as id",
  );
  return rows.reduce((_, row) => row.id, "");
}

// A plain role with no grant but to log in, as a worker holds no more for its status asks.
async function createPlainRole(server: TestPostgresDatabase): Promise<{
  readonly settings: PostgresSettings;
  readonly drop: () => Promise<void>;
}> {
  const role = `bnf_plain_${randomBytes(6).toString("hex")}`;
  const password = randomBytes(12).toString("hex");
  const admin = async (database: string, statement: string): Promise<void> => {
    const client = new Client(poolConfigOf({ ...server.settings, database }));
    await client.connect();
    try {
      await client.query(statement);
    } finally {
      await client.end();
    }
  };
  await admin(server.settings.database, `create role ${role} login password '${password}'`);
  await admin(server.settings.database, `create schema plain authorization ${role}`);
  return {
    settings: { ...server.settings, user: role, password },
    drop: async () => admin("postgres", `drop role ${role}`),
  };
}

function eventsSince(logger: ReturnType<typeof createMemoryLogger>, from: number) {
  return logger
    .records()
    .slice(from)
    .map(({ event, fields }) => ({ event, errorCode: fields?.["errorCode"] }));
}

describe.runIf(url !== "")("a Postgres write whose COMMIT answer was cut", () => {
  let server: TestPostgresDatabase;
  let direct: PostgresDatabase<Tables>;
  let proxy: CommitCutProxy;
  let cut: PostgresDatabase<Tables>;
  let plain: Awaited<ReturnType<typeof createPlainRole>>;
  const logger = createMemoryLogger({ subsystem: "store" });
  const call = { timeoutMs: 10_000, signal: never };
  const statusOf = () => createCommitStatus(() => new Client(poolConfigOf(plain.settings)), logger);

  beforeAll(async () => {
    server = await createTestPostgresDatabase(url);
    const ports = { clock: advancingClock(), random: createSeededRandom(5), logger, signal: never };
    direct = await openPostgres<Tables>(server.settings, ports);
    await direct.write(async ({ kysely, execute }) => {
      await execute(sql`create schema cut`.compile(kysely));
      await execute(sql`create table cut.rows (id bigint primary key)`.compile(kysely));
    }, never);
    proxy = await startCommitCutProxy(server.settings);
    cut = await openPostgres<Tables>({ ...server.settings, port: proxy.port }, ports);
    plain = await createPlainRole(server);
  });

  afterEach(() => {
    proxy.plan("pass");
    proxy.passChecks();
    proxy.releaseCommits();
    proxy.acceptNewConnections();
  });

  afterAll(async () => {
    await cut.close();
    await proxy.close();
    await direct.close();
    await server.drop();
    await plain.drop();
  });

  const rowsOf = async (id: number): Promise<number> =>
    direct.read(async ({ kysely, execute }) => {
      const rows = await execute(kysely.selectFrom("cut.rows").selectAll().where("id", "=", id));
      return rows.rows.length;
    }, never);

  it("answers what its task gave once the database says the commit landed", async () => {
    const runs = counter();
    proxy.plan("after", "next");
    await expect(cut.write(inserting(1, runs), never)).resolves.toBe(1);
    expect(proxy.cuts()).toBeGreaterThan(0);
    expect(runs.count()).toBe(1);
    await expect(rowsOf(1)).resolves.toBe(1);
  });

  it("runs again from its first read once the database says nothing landed", async () => {
    const runs = counter();
    proxy.plan("before", "next");
    await expect(cut.write(inserting(2, runs), never)).resolves.toBe(2);
    expect(runs.count()).toBe(2);
    await expect(rowsOf(2)).resolves.toBe(1);
  });

  it("ends a session whose COMMIT never came through its own check, then runs again", async () => {
    const runs = counter();
    proxy.plan("drop", "next");
    const from = logger.records().length;
    await expect(cut.write(inserting(3, runs), never)).resolves.toBe(3);
    expect(runs.count()).toBe(2);
    await expect(rowsOf(3)).resolves.toBe(1);
    expect(eventsSince(logger, from)).toStrictEqual(
      expect.arrayContaining([
        { event: "store.commit_session_ended", errorCode: undefined },
        { event: "store.commit_lost", errorCode: "rerun" },
      ]),
    );
  });

  it("runs again when the server's idle timeout ends a held COMMIT, its failed ROLLBACK read as lost", async () => {
    const runs = counter();
    proxy.plan("hold", "next");
    const from = logger.records().length;
    await expect(cut.write(inserting(7, runs), never)).resolves.toBe(7);
    expect(runs.count()).toBe(2);
    await expect(rowsOf(7)).resolves.toBe(1);
    const events = eventsSince(logger, from);
    expect(events).toContainEqual({ event: "store.commit_lost", errorCode: "rerun" });
    expect(events.map(({ event }) => event)).not.toContain("store.commit_session_ended");
  });

  it("fails commit_unknown with its transaction id when the database cannot be asked", async () => {
    const runs = counter();
    proxy.plan("after", "next");
    const writing = cut.write(async (connection) => {
      const id = await inserting(4, runs)(connection);
      proxy.refuseNewConnections();
      return id;
    }, never);
    const failed = await writing.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failed).toMatchObject({ code: "store.commit_unknown" });
    expect(String((failed as BinferenceError).details["transactionId"])).toMatch(/^[0-9]+$/);
    proxy.acceptNewConnections();
    await expect(rowsOf(4)).resolves.toBe(1);
  });

  it("runs a write that wrote nothing again rather than asking about it", async () => {
    const runs = counter();
    proxy.plan("after", "next");
    const reading = cut.write(async ({ kysely, execute }) => {
      runs.add();
      return (await execute(kysely.selectFrom("cut.rows").selectAll())).rows.length;
    }, never);
    await expect(reading).resolves.toBeGreaterThanOrEqual(0);
    expect(runs.count()).toBe(2);
  });

  it("ends the session of a commit aborted in doubt, and gives the caller's abort", async () => {
    const runs = counter();
    const caller = new AbortController();
    const reason = new Error("the engine stops");
    proxy.plan("hold", "next");
    void proxy.held().then(() => caller.abort(reason));
    const from = logger.records().length;
    await expect(cut.write(inserting(6, runs), caller.signal)).rejects.toBe(reason);
    expect(runs.count()).toBe(1);
    await expect(rowsOf(6)).resolves.toBe(0);
    const events = eventsSince(logger, from).map(({ event }) => event);
    expect(events).toContain("store.commit_session_ended");
  });

  it("answers COMMIT's own answer when it comes while the check runs, and ends no session", async () => {
    const runs = counter();
    const caller = new AbortController();
    proxy.plan("hold", "next");
    proxy.holdChecks();
    const from = logger.records().length;
    const writing = cut.write(inserting(8, runs), caller.signal);
    await proxy.held();
    caller.abort(new Error("the engine stops"));
    await proxy.checkHeld();
    proxy.releaseCommits();
    await expect(writing).resolves.toBe(8);
    expect(runs.count()).toBe(1);
    await expect(rowsOf(8)).resolves.toBe(1);
    const events = eventsSince(logger, from).map(({ event }) => event);
    expect(events).not.toContain("store.commit_lost");
    expect(events).not.toContain("store.commit_session_ended");
  });

  it("gives up a status ask and a session end the network holds once their time passed", async () => {
    const status = createCommitStatus(
      () => new Client(poolConfigOf({ ...server.settings, port: proxy.port })),
      logger,
    );
    const session = await openSession(server.settings);
    try {
      proxy.holdChecks();
      const from = logger.records().length;
      const short = { timeoutMs: 300, signal: never };
      await expect(status.ask(session.identity, short)).resolves.toStrictEqual({
        kind: "unreachable",
      });
      await status.end(session.identity, short);
      expect(eventsSince(logger, from).map(({ event }) => event)).toStrictEqual([
        "store.commit_check_failed",
        "store.commit_check_failed",
      ]);
      await expect(session.client.query("select 1 as one")).resolves.toMatchObject({
        rows: [{ one: 1 }],
      });
    } finally {
      await session.client.end();
    }
  });

  describe("as a plain role, with only the worker's grants", () => {
    it("asks how a write ended through the cut, and reads it landed", async () => {
      const proxied = { ...plain.settings, port: proxy.port };
      const ports = {
        clock: advancingClock(),
        random: createSeededRandom(6),
        logger,
        signal: never,
      };
      const writer = await openPostgres<{ readonly "plain.rows": { readonly id: number } }>(
        proxied,
        ports,
      );
      try {
        await writer.write(async ({ kysely, execute }) => {
          await execute(sql`create table plain.rows (id bigint primary key)`.compile(kysely));
        }, never);
        proxy.plan("after", "next");
        const writing = writer.write(async ({ kysely, execute }) => {
          await execute(kysely.insertInto("plain.rows").values({ id: 1 }));
          return 1;
        }, never);
        await expect(writing).resolves.toBe(1);
        expect(proxy.cuts()).toBeGreaterThan(0);
      } finally {
        await writer.close();
      }
    });

    it("reads another server start as unable to tell", async () => {
      const session = await openSession(plain.settings);
      try {
        const moved = { ...session.identity, serverStart: "2000-01-01 00:00:00+00" };
        await expect(statusOf().ask(moved, call)).resolves.toStrictEqual({ kind: "other_server" });
        await expect(statusOf().ask(session.identity, call)).resolves.toStrictEqual({
          kind: "status",
          status: "in progress",
          isAlive: true,
        });
      } finally {
        await session.client.end();
      }
    });

    it("ends a session only while it runs the write's own transaction", async () => {
      const session = await openSession(plain.settings);
      try {
        await session.client.query("commit");
        await statusOf().end(session.identity, call);
        await expect(session.client.query("select 1 as one")).resolves.toMatchObject({
          rows: [{ one: 1 }],
        });
        await session.client.query("begin");
        const transactionId = await transactionIdOf(session.client);
        await statusOf().end({ ...session.identity, transactionId }, call);
        await expect(session.client.query("select 1 as one")).rejects.toThrow(/not queryable/);
      } finally {
        await session.client.end().catch(() => undefined);
      }
    });

    it("never ends a session whose start differs, as one under a reused process id", async () => {
      const session = await openSession(plain.settings);
      try {
        const reused = { ...session.identity, sessionStart: "1999-01-01 00:00:00+00" };
        await statusOf().end(reused, call);
        await expect(session.client.query("select 1 as one")).resolves.toMatchObject({
          rows: [{ one: 1 }],
        });
      } finally {
        await session.client.end();
      }
    });
  });
});
