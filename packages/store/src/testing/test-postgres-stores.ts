import { setTimeout as delay } from "node:timers/promises";
import { type Clock, idSchema } from "@binference/core";
// Store adapter tests on Postgres run each port's contract suite on a fresh install's schemas,
// with the tasks on a task thread, as the SQLite tests run it on a fresh file. Nothing in
// production uses this file.
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { okValue } from "../contracts/agent-fixtures.js";
import { workerIdSchema } from "../leases/agent-leases.js";
import { installSchemas } from "../migrations/install-schemas.js";
import { createPostgresInstall } from "../migrations/postgres-install.js";
import { prepareSharedSchema } from "../migrations/prepare-shared-schema.js";
import type { MetaTables } from "../migrations/run-postgres-migrations.js";
import type { StoreLease } from "../postgres/lease-fence.js";
import { openPostgres, type PostgresDatabase } from "../postgres/open-postgres.js";
import { createPostgresAgentLeases } from "../postgres/postgres-agent-leases.js";
import type { PostgresSettings } from "../postgres/postgres-settings.js";
import { createPostgresStoreHost } from "../postgres/postgres-store-host.js";
import {
  type PostgresTaskThread,
  startPostgresTaskThread,
} from "../postgres/postgres-task-thread.js";
import type { StoreHost } from "../tasks/store-host.js";
import { testAgentWorker } from "./test-agent-database.js";
import { testEngineWorker } from "./test-engine-database.js";
import { createTestPostgresDatabase, ignoreCommitUnknown } from "./test-postgres.js";

/** The databases an install holds, by the name their definitions give them. */
type InstallDatabase = "engine" | "agent";

/** Fresh installs on the test server, for one test file's adapter tests. */
export interface TestPostgresStores {
  /**
   * A store host on a new install's schema of `database`, migrated to this build's version: the
   * Postgres side of `createTestDatabases().open(definition).host`.
   */
  open(database: InstallDatabase): Promise<StoreHost>;
  /**
   * `count` store hosts on one new install's schema of `database`, the engine's unless named,
   * each with its own pool, task thread and write queue: writers of one install whose writes
   * interleave under `SERIALIZABLE` (decision 0366). A retry waits as it does in production.
   */
  writers(count: number, database?: InstallDatabase): Promise<readonly StoreHost[]>;
  /** How many writes the writers' pools ran again after a conflict, so far. */
  retries(): number;
  /** Ends the task threads, closes the pool and drops the test database. */
  closeAll(): Promise<void>;
}

// Each database's task thread also serves the tasks the tests read and plant rows through.
const workers: Readonly<Record<InstallDatabase, URL>> = {
  engine: testEngineWorker,
  agent: testAgentWorker,
};
// Task threads run the TypeScript source, as the store's other worker tests do.
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const sharedSchema = "shared";
// The file's one worker holds each install's lease for longer than a file runs; nothing renews it.
const testWorker = workerIdSchema.parse("test-worker");
const testLeaseMs = 3_600_000;

// The writers' retries wait out decision 0366's backoff, so racing writes spread as they do live.
const waitingClock: Clock = {
  now: () => Date.now(),
  sleep: async (delayMs, signal) => delay(delayMs, undefined, { signal }),
};

// Each call gets its own 30 s: one signal made once would bound the whole file.
function call(): AbortSignal {
  return AbortSignal.timeout(30_000);
}

interface Writer {
  readonly pool: PostgresDatabase<MetaTables>;
  readonly thread: PostgresTaskThread;
}

/** Where a store host writes: an install's schema, under the install's lease. */
interface HostPlace {
  readonly schema: string;
  readonly lease: StoreLease;
}

/** The racing writers of a file: each its own pool and task thread, which serve every install. */
interface Writers {
  hostsOn(
    database: InstallDatabase,
    place: HostPlace,
    count: number,
  ): Promise<readonly StoreHost[]>;
  retries(): number;
  close(): Promise<void>;
}

// A writer's pool and task thread of a database start once and serve every install of the file,
// as a task thread serves many installs' schemas; each `hostsOn` binds new hosts to the schema it
// names.
function createWriters(settings: PostgresSettings): Writers {
  const log = createMemoryLogger({ subsystem: "store", maxRecords: 100_000 });
  const started = new Map<string, Promise<Writer>>();
  const start = async (database: InstallDatabase, n: number): Promise<Writer> => {
    const ports = { clock: waitingClock, random: createSeededRandom(100 + n), logger: log };
    const pool = await openPostgres<MetaTables>(settings, { ...ports, signal: call() });
    const thread = await startPostgresTaskThread({
      worker: workers[database],
      execArgv,
      signal: call(),
    });
    return { pool, thread };
  };
  const hostOn = async (database: InstallDatabase, place: HostPlace, n: number) => {
    const key = `${database} ${String(n)}`;
    const writer = started.get(key) ?? start(database, n);
    started.set(key, writer);
    const { pool, thread } = await writer;
    return createPostgresStoreHost({
      database: pool,
      thread,
      ...place,
      onCommitUnknown: ignoreCommitUnknown,
    });
  };
  return {
    hostsOn: async (database, place, count) =>
      Promise.all(Array.from({ length: count }, async (_, n) => hostOn(database, place, n))),
    retries: () => log.records().filter(({ event }) => event === "store.write_retried").length,
    // Each writer's thread ends before its pool closes.
    close: async () => {
      const writers = [...started.values()];
      started.clear();
      await Promise.all(
        writers.map(async (writer) => {
          const { pool, thread } = await writer;
          await thread.close();
          await pool.close();
        }),
      );
    },
  };
}

/**
 * Opens a database of its own on the test server that `url` names (`inject("postgres")`), with
 * the shared schema prepared; each `open` adds an install, whose lease the file's one worker takes
 * for its hosts. One task thread per database serves every install of the file.
 */
export async function createTestPostgresStores(url: string): Promise<TestPostgresStores> {
  const server = await createTestPostgresDatabase(url);
  const database = await openPostgres<MetaTables>(server.settings, {
    clock: { now: () => Date.now(), sleep: async () => Promise.resolve() },
    random: createSeededRandom(17),
    logger: createMemoryLogger({ subsystem: "store" }),
    signal: call(),
  });
  await prepareSharedSchema(database, sharedSchema, call());
  const threads = new Map<InstallDatabase, Promise<PostgresTaskThread>>();
  const threadOf = async (name: InstallDatabase): Promise<PostgresTaskThread> => {
    const thread =
      threads.get(name) ??
      startPostgresTaskThread({ worker: workers[name], execArgv, signal: call() });
    threads.set(name, thread);
    return thread;
  };
  const leases = createPostgresAgentLeases({ database, sharedSchema, leaseMs: testLeaseMs });
  let installs = 0;
  const newPlace = async (name: InstallDatabase): Promise<HostPlace> => {
    installs += 1;
    const digits = String(installs).padStart(12, "0");
    const installId = idSchema("ins").parse(`ins_0190f1c2-3a4b-7c5d-8e6f-${digits}`);
    await createPostgresInstall(database, { installId, sharedSchema }, call());
    const held = okValue(
      await leases.take({ installId, workerId: testWorker }, { signal: call() }),
    );
    return { schema: installSchemas(installId)[name], lease: { sharedSchema, held } };
  };
  const writers = createWriters(server.settings);
  return {
    async open(name) {
      const place = { ...(await newPlace(name)), onCommitUnknown: ignoreCommitUnknown };
      return createPostgresStoreHost({ database, thread: await threadOf(name), ...place });
    },
    writers: async (count, name = "engine") => writers.hostsOn(name, await newPlace(name), count),
    retries: () => writers.retries(),
    async closeAll() {
      const started = await Promise.all(threads.values());
      await Promise.all(started.map(async (thread) => thread.close()));
      await writers.close();
      await database.close();
      await server.drop();
    },
  };
}
