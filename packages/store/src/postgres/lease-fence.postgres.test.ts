import type { Id } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createSqliteSessionStore } from "../chats/sqlite-session-store.js";
import { createSqliteWriterFence } from "../chats/sqlite-writer-fence.js";
import { go, nthId, okValue } from "../contracts/agent-fixtures.js";
import { type HeldLease, workerIdSchema } from "../leases/agent-leases.js";
import { installSchemas } from "../migrations/install-schemas.js";
import { createPostgresInstall } from "../migrations/postgres-install.js";
import { prepareSharedSchema } from "../migrations/prepare-shared-schema.js";
import type { MetaTables } from "../migrations/run-postgres-migrations.js";
import type { StoreHost } from "../tasks/store-host.js";
import { plantAgentOn } from "../testing/plant-agent.js";
import { probeWorker, recordThenSleep, summarize } from "../testing/probe-database.js";
import { createProbeInstall } from "../testing/probe-install.js";
import { testAgentWorker } from "../testing/test-agent-database.js";
import { testEngineWorker } from "../testing/test-engine-database.js";
import { createTestPostgresDatabase, type TestPostgresDatabase } from "../testing/test-postgres.js";
import { openPostgres, type PostgresDatabase } from "./open-postgres.js";
import { createPostgresAgentLeases } from "./postgres-agent-leases.js";
import { createPostgresStoreHost } from "./postgres-store-host.js";
import { type PostgresTaskThread, startPostgresTaskThread } from "./postgres-task-thread.js";

const url = inject("postgres");
const never = new AbortController().signal;
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const sharedSchema = "shared";
const workerA = workerIdSchema.parse("worker-a");
const workerB = workerIdSchema.parse("worker-b");
// Short, so a check waits a lease out; the long one outlasts the file.
const shortLeaseMs = 300;
const longLeaseMs = 3_600_000;

/** One install's two store hosts, both under one lease. */
interface Hosts {
  readonly engine: StoreHost;
  readonly agent: StoreHost;
}

const lost = { code: "store.lease_lost" };

// Each refused write changed nothing: the holder then plants the same agent, which a landed
// plant would have refused, and raises the agent schema's writer fence from nothing to 1.
async function refusedInBoth(stale: Hosts, holder: Hosts): Promise<void> {
  await expect(plantAgentOn(stale.engine, 1)).rejects.toMatchObject(lost);
  await expect(createSqliteWriterFence(stale.agent).raise(go())).rejects.toMatchObject(lost);
  await expect(plantAgentOn(holder.engine, 1)).resolves.toMatchObject({
    agentId: nthId("agt", 1),
  });
  await expect(createSqliteWriterFence(holder.agent).raise(go())).resolves.toBe(1);
}

async function start(worker: URL): Promise<PostgresTaskThread> {
  return startPostgresTaskThread({ worker, execArgv, signal: AbortSignal.timeout(30_000) });
}

describe.runIf(url !== "")("the lease fence of a Postgres store host", () => {
  let server: TestPostgresDatabase;
  let database: PostgresDatabase<MetaTables>;
  const threads: Partial<Record<"engine" | "agent" | "probe", PostgresTaskThread>> = {};
  let installs = 0;

  beforeAll(async () => {
    server = await createTestPostgresDatabase(url);
    database = await openPostgres<MetaTables>(server.settings, {
      clock: { now: () => 0, sleep: async () => Promise.resolve() },
      random: createSeededRandom(13),
      logger: createMemoryLogger({ subsystem: "store" }),
      signal: never,
    });
    await prepareSharedSchema(database, sharedSchema, never);
    threads.engine = await start(testEngineWorker);
    threads.agent = await start(testAgentWorker);
    threads.probe = await start(probeWorker);
  });

  afterAll(async () => {
    await Promise.all(Object.values(threads).map(async (thread) => thread.close()));
    await database.close();
    await server.drop();
  });

  const leasesOf = (leaseMs: number) =>
    createPostgresAgentLeases({ database, sharedSchema, leaseMs });

  const threadOf = (name: "engine" | "agent" | "probe"): PostgresTaskThread => {
    const thread = threads[name];
    expect(thread).toBeDefined();
    return thread as PostgresTaskThread;
  };

  const newInstall = async (): Promise<Id<"ins">> => {
    installs += 1;
    const installId = nthId("ins", installs);
    await createPostgresInstall(database, { installId, sharedSchema }, never);
    return installId;
  };

  const hostsOf = (held: HeldLease): Hosts => {
    const schemas = installSchemas(held.installId);
    const lease = { sharedSchema, held };
    return {
      engine: createPostgresStoreHost({
        database,
        thread: threadOf("engine"),
        schema: schemas.engine,
        lease,
      }),
      agent: createPostgresStoreHost({
        database,
        thread: threadOf("agent"),
        schema: schemas.agent,
        lease,
      }),
    };
  };

  const passes = async (ms: number): Promise<void> => {
    await database.read(async ({ kysely, execute }) => {
      await execute(sql`select pg_sleep(${ms / 1_000})`.compile(kysely));
    }, never);
  };

  it("writes both schemas while its worker holds the install", async () => {
    const installId = await newInstall();
    const held = okValue(await leasesOf(longLeaseMs).take({ installId, workerId: workerA }, go()));
    const hosts = hostsOf(held);
    await expect(plantAgentOn(hosts.engine, 1)).resolves.toBeDefined();
    await expect(createSqliteWriterFence(hosts.agent).raise(go())).resolves.toBe(1);
  });

  it("refuses a write under an old fence in both schemas, and it changes nothing", async () => {
    const installId = await newInstall();
    const leases = leasesOf(longLeaseMs);
    const old = okValue(await leases.take({ installId, workerId: workerA }, go()));
    await leases.stop(old, go());
    const held = okValue(await leases.take({ installId, workerId: workerA }, go()));
    await expect(refusedInBoth(hostsOf(old), hostsOf(held))).resolves.toBeUndefined();
  });

  it("refuses a write under another worker's name in both schemas", async () => {
    const installId = await newInstall();
    const held = okValue(await leasesOf(longLeaseMs).take({ installId, workerId: workerA }, go()));
    const stranger = hostsOf({ ...held, workerId: workerB });
    await expect(refusedInBoth(stranger, hostsOf(held))).resolves.toBeUndefined();
  });

  it("refuses a write once the lease expired, though no worker took the install", async () => {
    const installId = await newInstall();
    const leases = leasesOf(shortLeaseMs);
    const held = okValue(await leases.take({ installId, workerId: workerA }, go()));
    await passes(shortLeaseMs + 50);
    const expired = hostsOf(held);
    await expect(plantAgentOn(expired.engine, 1)).rejects.toMatchObject(lost);
    await expect(createSqliteWriterFence(expired.agent).raise(go())).rejects.toMatchObject(lost);
    // Renewed, the same lease holds again, and finds nothing of the refused writes.
    const renewed = hostsOf(okValue(await leasesOf(longLeaseMs).renew(held, go())));
    await expect(plantAgentOn(renewed.engine, 1)).resolves.toBeDefined();
    await expect(createSqliteWriterFence(renewed.agent).raise(go())).resolves.toBe(1);
  });

  it("refuses every write of a host with no lease, and still reads", async () => {
    const schemas = installSchemas(await newInstall());
    const bare = {
      engine: createPostgresStoreHost({
        database,
        thread: threadOf("engine"),
        schema: schemas.engine,
      }),
      agent: createPostgresStoreHost({
        database,
        thread: threadOf("agent"),
        schema: schemas.agent,
      }),
    };
    await expect(plantAgentOn(bare.engine, 1)).rejects.toMatchObject(lost);
    await expect(createSqliteWriterFence(bare.agent).raise(go())).rejects.toMatchObject(lost);
    const sessions = createSqliteSessionStore(bare.agent);
    await expect(sessions.get(nthId("ses", 1), go())).resolves.toBeUndefined();
  });

  it("refuses at its start a host bound to another install's lease", async () => {
    const held = okValue(
      await leasesOf(longLeaseMs).take({ installId: await newInstall(), workerId: workerA }, go()),
    );
    const other = installSchemas(await newInstall());
    expect(() =>
      createPostgresStoreHost({
        database,
        thread: threadOf("engine"),
        schema: other.engine,
        lease: { sharedSchema, held },
      }),
    ).toThrow(expect.objectContaining({ code: "store.lease_mismatch" }));
  });

  it("makes a take wait for a write that passed the check, which commits first", async () => {
    installs += 1;
    const probe = await createProbeInstall(database, { sharedSchema, n: installs }, never);
    const leases = leasesOf(shortLeaseMs);
    const held = okValue(
      await leases.take({ installId: probe.installId, workerId: workerA }, go()),
    );
    const host = createPostgresStoreHost({
      database,
      thread: threadOf("probe"),
      schema: probe.schema,
      lease: { sharedSchema, held },
    });
    const ended: string[] = [];
    // The write passes the check at once, then holds its transaction for a second on the server.
    const writing = host.run(recordThenSleep, { writer: 1, seq: 1 }, go()).then((counter) => {
      ended.push("write");
      return counter;
    });
    await passes(shortLeaseMs + 200);
    const taking = leases
      .take({ installId: probe.installId, workerId: workerB }, go())
      .then((taken) => {
        ended.push("take");
        return taken;
      });
    await expect(writing).resolves.toBe(1);
    expect(okValue(await taking).fence).toBe(held.fence + 1);
    expect(ended).toStrictEqual(["write", "take"]);
    await expect(host.run(summarize, null, go())).resolves.toMatchObject({ rows: 1 });
  });
});
