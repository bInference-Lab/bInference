import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import * as fc from "fast-check";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { go } from "../contracts/agent-fixtures.js";
import { type AgentLeases, type HeldLease, workerIdSchema } from "../leases/agent-leases.js";
import { prepareSharedSchema } from "../migrations/prepare-shared-schema.js";
import type { MetaTables } from "../migrations/run-postgres-migrations.js";
import type { StoreHost } from "../tasks/store-host.js";
import { probeWorker, recordStamped, summarize } from "../testing/probe-database.js";
import { createProbeInstall, type ProbeInstall } from "../testing/probe-install.js";
import {
  createTestPostgresDatabase,
  ignoreCommitUnknown,
  type TestPostgresDatabase,
} from "../testing/test-postgres.js";
import { openPostgres, type PostgresDatabase } from "./open-postgres.js";
import { createPostgresAgentLeases } from "./postgres-agent-leases.js";
import { createPostgresStoreHost } from "./postgres-store-host.js";
import { type PostgresTaskThread, startPostgresTaskThread } from "./postgres-task-thread.js";

// K2: several workers take, renew, stop, pause and write on one install, each on its own pool and
// task thread, the moves of one round running at once. No write may commit for a worker that did
// not hold the install when it committed.

const url = inject("postgres");
const never = new AbortController().signal;
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const sharedSchema = "shared";
const leaseMs = 100;
// A pause outlives a lease, and a stalled write keeps its transaction open past a pause, so a
// late take in its round comes while it still runs.
const pauseMs = 150;
const stallMs = 250;
const workerCount = 3;

type Move = "take" | "lateTake" | "renew" | "stop" | "pause" | "write" | "stall";

const move: fc.Arbitrary<Move> = fc.oneof(
  { arbitrary: fc.constant("take" as const), weight: 3 },
  { arbitrary: fc.constant("lateTake" as const), weight: 2 },
  { arbitrary: fc.constant("renew" as const), weight: 1 },
  { arbitrary: fc.constant("stop" as const), weight: 1 },
  { arbitrary: fc.constant("pause" as const), weight: 2 },
  { arbitrary: fc.constant("write" as const), weight: 4 },
  { arbitrary: fc.constant("stall" as const), weight: 2 },
);

type Plan = readonly (readonly (Move | undefined)[])[];

/** Each round, every worker's move or none; a round's moves run at once. */
const plans: fc.Arbitrary<Plan> = fc.array(
  fc.array(fc.option(move, { nil: undefined }), {
    minLength: workerCount,
    maxLength: workerCount,
  }),
  { minLength: 2, maxLength: 6 },
);

interface Worker {
  readonly n: number;
  readonly pool: PostgresDatabase<MetaTables>;
  readonly thread: PostgresTaskThread;
  readonly leases: AgentLeases;
}

/** One plan's run: its install, the lease each worker last took, and what it saw. */
interface Run {
  readonly probe: ProbeInstall;
  readonly held: Map<number, HeldLease>;
  /** Every take that succeeded. */
  readonly takes: HeldLease[];
  /** Every write that committed, under the lease its worker wrote with. */
  readonly committed: { readonly lease: HeldLease | undefined; readonly atMs: number }[];
  /** The next write's number, one more at each call. */
  readonly nextSeq: () => number;
}

function hostOf(worker: Worker, probe: ProbeInstall, lease: HeldLease | undefined): StoreHost {
  const { pool, thread } = worker;
  const place = { database: pool, thread, schema: probe.schema };
  return createPostgresStoreHost(
    lease === undefined
      ? place
      : { ...place, lease: { sharedSchema, held: lease }, onCommitUnknown: ignoreCommitUnknown },
  );
}

async function takeMove(worker: Worker, run: Run): Promise<void> {
  const workerId = workerIdSchema.parse(`worker-${String(worker.n)}`);
  const taken = await worker.leases.take({ installId: run.probe.installId, workerId }, go());
  if (taken.ok) {
    run.held.set(worker.n, taken.value);
    run.takes.push(taken.value);
  }
}

async function renewMove(worker: Worker, run: Run): Promise<void> {
  const lease = run.held.get(worker.n);
  const renewed = lease === undefined ? undefined : await worker.leases.renew(lease, go());
  if (renewed?.ok === true) {
    run.held.set(worker.n, renewed.value);
  }
}

async function stopMove(worker: Worker, run: Run): Promise<void> {
  const lease = run.held.get(worker.n);
  await (lease === undefined ? Promise.resolve() : worker.leases.stop(lease, go()));
}

async function pauseMove(worker: Worker): Promise<void> {
  await worker.pool.read(async ({ kysely, execute }) => {
    await execute(sql`select pg_sleep(${pauseMs / 1_000})`.compile(kysely));
  }, never);
}

// A write under the lease its worker last took, whether or not it still holds; a stalled one
// sits idle in its transaction before it reads the clock and commits.
function writeMove(stall: number): (worker: Worker, run: Run) => Promise<void> {
  return async (worker, run) => {
    const lease = run.held.get(worker.n);
    const input = { writer: worker.n, seq: run.nextSeq(), stallMs: stall };
    const atMs = await hostOf(worker, run.probe, lease)
      .run(recordStamped, input, go())
      .catch(() => undefined);
    if (atMs !== undefined) {
      run.committed.push({ lease, atMs });
    }
  };
}

const moves: Readonly<Record<Move, (worker: Worker, run: Run) => Promise<void>>> = {
  take: takeMove,
  lateTake: async (worker, run) => {
    await pauseMove(worker);
    await takeMove(worker, run);
  },
  renew: renewMove,
  stop: stopMove,
  pause: pauseMove,
  write: writeMove(0),
  stall: writeMove(stallMs),
};

// A write that committed under a fence its worker never took, or after a later take of the
// install, is one by a worker that did not hold the install. A take waits for every write that
// passed the check, so it reads the clock after each such write read it.
function violations(run: Run): readonly string[] {
  return run.committed.flatMap(({ lease, atMs }) => {
    if (lease === undefined) {
      return [`a write with no lease committed at ${String(atMs)}`];
    }
    const own = run.takes.find((take) => take.fence === lease.fence);
    const later = run.takes.find((take) => take.fence > lease.fence && take.takenAtMs < atMs);
    const wrote = `${lease.workerId} wrote under fence ${String(lease.fence)} at ${String(atMs)}`;
    if (own?.workerId !== lease.workerId) {
      return [`${wrote}, a fence it never took`];
    }
    if (later === undefined) {
      return [];
    }
    const taken = `${later.workerId} took fence ${String(later.fence)} at ${String(later.takenAtMs)}`;
    return [`${wrote}, after ${taken}`];
  });
}

describe.runIf(url !== "")("the install lease of several workers", () => {
  let server: TestPostgresDatabase;
  let database: PostgresDatabase<MetaTables>;
  let workers: readonly Worker[] = [];
  let installs = 0;

  const open = async (n: number): Promise<PostgresDatabase<MetaTables>> =>
    openPostgres<MetaTables>(server.settings, {
      clock: { now: () => 0, sleep: async () => Promise.resolve() },
      random: createSeededRandom(30 + n),
      logger: createMemoryLogger({ subsystem: "store" }),
      signal: never,
    });

  beforeAll(async () => {
    server = await createTestPostgresDatabase(url);
    database = await open(workerCount);
    await prepareSharedSchema(database, sharedSchema, never);
    workers = await Promise.all(
      Array.from({ length: workerCount }, async (_, n) => {
        const pool = await open(n);
        const signal = AbortSignal.timeout(30_000);
        const thread = await startPostgresTaskThread({ worker: probeWorker, execArgv, signal });
        return {
          n,
          pool,
          thread,
          leases: createPostgresAgentLeases({ database: pool, sharedSchema, leaseMs }),
        };
      }),
    );
  });

  afterAll(async () => {
    await Promise.all(
      workers.map(async ({ thread, pool }) => {
        await thread.close();
        await pool.close();
      }),
    );
    await database.close();
    await server.drop();
  });

  const runPlan = async (plan: Plan): Promise<void> => {
    installs += 1;
    const probe = await createProbeInstall(database, { sharedSchema, n: installs }, never);
    let seq = 0;
    const run: Run = {
      probe,
      held: new Map(),
      takes: [],
      committed: [],
      nextSeq: () => {
        seq += 1;
        return seq;
      },
    };
    await plan.reduce(async (before, round) => {
      await before;
      await Promise.all(
        workers.map(async (worker) => {
          const next = round[worker.n];
          return next === undefined ? undefined : moves[next](worker, run);
        }),
      );
    }, Promise.resolve());
    expect(violations(run)).toStrictEqual([]);
    expect(new Set(run.takes.map((take) => take.fence)).size).toBe(run.takes.length);
    const [first] = workers;
    expect(first).toBeDefined();
    const reader = hostOf(first as Worker, probe, undefined);
    await expect(reader.run(summarize, null, go())).resolves.toMatchObject({
      rows: run.committed.length,
    });
  };

  it("commits no write for a worker that did not hold the install", async () => {
    const property = fc.asyncProperty(plans, runPlan);
    await expect(fc.assert(property, { numRuns: 20, endOnFailure: true })).resolves.toBeUndefined();
  });
});
