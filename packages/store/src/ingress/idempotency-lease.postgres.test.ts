import type { Id } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { type IdempotencyMark, sha256HexSchema } from "@binference/engine";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { go, nthId, okValue } from "../contracts/agent-fixtures.js";
import { type HeldLease, workerIdSchema } from "../leases/agent-leases.js";
import { installSchemas } from "../migrations/install-schemas.js";
import { createPostgresInstall } from "../migrations/postgres-install.js";
import { prepareSharedSchema } from "../migrations/prepare-shared-schema.js";
import type { MetaTables } from "../migrations/run-postgres-migrations.js";
import { openPostgres, type PostgresDatabase } from "../postgres/open-postgres.js";
import { createPostgresAgentLeases } from "../postgres/postgres-agent-leases.js";
import { createPostgresStoreHost } from "../postgres/postgres-store-host.js";
import {
  type PostgresTaskThread,
  startPostgresTaskThread,
} from "../postgres/postgres-task-thread.js";
import { testEngineWorker } from "../testing/test-engine-database.js";
import {
  createTestPostgresDatabase,
  ignoreCommitUnknown,
  type TestPostgresDatabase,
} from "../testing/test-postgres.js";
import { createSqliteIdempotencyStore } from "./sqlite-idempotency-store.js";

const url = inject("postgres");
const never = new AbortController().signal;
const sharedSchema = "shared";
const workerA = workerIdSchema.parse("worker-a");
const workerB = workerIdSchema.parse("worker-b");
const lost = { code: "store.lease_lost" };

function mark(key: string, args = "a"): IdempotencyMark {
  return {
    credential: nthId("tok", 1),
    op: "intent/propose",
    key,
    argsHash: sha256HexSchema.parse(args.repeat(64)),
    atMs: 1_000,
  };
}

// A key's mark passes the install's lease fence like any write (decision 0437), so a worker that
// lost the install, or holds none, neither marks a key nor fills or forgets one it marked.
describe.runIf(url !== "")("the idempotency store under an install's lease on Postgres", () => {
  let server: TestPostgresDatabase;
  let database: PostgresDatabase<MetaTables>;
  let thread: PostgresTaskThread;
  let installs = 0;

  beforeAll(async () => {
    server = await createTestPostgresDatabase(url);
    database = await openPostgres<MetaTables>(server.settings, {
      clock: { now: () => 0, sleep: async () => Promise.resolve() },
      random: createSeededRandom(17),
      logger: createMemoryLogger({ subsystem: "store" }),
      signal: never,
    });
    await prepareSharedSchema(database, sharedSchema, never);
    thread = await startPostgresTaskThread({
      worker: testEngineWorker,
      execArgv: ["--conditions=@binference/source", "--import", "tsx"],
      signal: AbortSignal.timeout(30_000),
    });
  });

  afterAll(async () => {
    await thread.close();
    await database.close();
    await server.drop();
  });

  const newInstall = async (): Promise<Id<"ins">> => {
    installs += 1;
    const installId = nthId("ins", installs);
    await createPostgresInstall(database, { installId, sharedSchema }, never);
    return installId;
  };

  const storeOf = (installId: Id<"ins">, held?: HeldLease) =>
    createSqliteIdempotencyStore(
      createPostgresStoreHost({
        database,
        thread,
        schema: installSchemas(installId).engine,
        ...(held === undefined
          ? {}
          : { lease: { sharedSchema, held }, onCommitUnknown: ignoreCommitUnknown }),
      }),
    );

  it("answers a key the worker that lost the install marked as unfinished, and keeps it so", async () => {
    const installId = await newInstall();
    const leases = createPostgresAgentLeases({ database, sharedSchema, leaseMs: 3_600_000 });
    const first = okValue(await leases.take({ installId, workerId: workerA }, go()));
    const before = storeOf(installId, first);
    await expect(before.start(mark("k1"), go())).resolves.toStrictEqual({ kind: "started" });
    await leases.stop(first, go());
    const next = storeOf(
      installId,
      okValue(await leases.take({ installId, workerId: workerB }, go())),
    );
    await expect(next.start(mark("k1"), go())).resolves.toStrictEqual({ kind: "unfinished" });
    await expect(next.start(mark("k1", "b"), go())).resolves.toStrictEqual({ kind: "reused" });
    await expect(before.finish({ ...mark("k1"), result: 1 }, go())).rejects.toMatchObject(lost);
    await expect(before.forget(mark("k1"), go())).rejects.toMatchObject(lost);
    await expect(before.start(mark("k2"), go())).rejects.toMatchObject(lost);
    await expect(next.start(mark("k1"), go())).resolves.toStrictEqual({ kind: "unfinished" });
    await expect(next.start(mark("k2"), go())).resolves.toStrictEqual({ kind: "started" });
  });

  it("marks no key for a host that holds no lease", async () => {
    const installId = await newInstall();
    await expect(storeOf(installId).start(mark("k1"), go())).rejects.toMatchObject(lost);
    const leases = createPostgresAgentLeases({ database, sharedSchema, leaseMs: 3_600_000 });
    const held = okValue(await leases.take({ installId, workerId: workerA }, go()));
    await expect(storeOf(installId, held).start(mark("k1"), go())).resolves.toStrictEqual({
      kind: "started",
    });
  });
});
