import { idSchema } from "@binference/core";
// Store adapter tests on Postgres run each port's contract suite on a fresh install's schemas,
// with the tasks on a task thread, as the SQLite tests run it on a fresh file. Nothing in
// production uses this file.
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { agentWorker } from "../databases/agent-database.js";
import { installSchemas } from "../migrations/install-schemas.js";
import { createPostgresInstall } from "../migrations/postgres-install.js";
import { prepareSharedSchema } from "../migrations/prepare-shared-schema.js";
import type { MetaTables } from "../migrations/run-postgres-migrations.js";
import { openPostgres } from "../postgres/open-postgres.js";
import { createPostgresStoreHost } from "../postgres/postgres-store-host.js";
import {
  type PostgresTaskThread,
  startPostgresTaskThread,
} from "../postgres/postgres-task-thread.js";
import type { StoreHost } from "../tasks/store-host.js";
import { testEngineWorker } from "./test-engine-database.js";
import { createTestPostgresDatabase } from "./test-postgres.js";

/** The databases an install holds, by the name their definitions give them. */
type InstallDatabase = "engine" | "agent";

/** Fresh installs on the test server, for one test file's adapter tests. */
export interface TestPostgresStores {
  /**
   * A store host on a new install's schema of `database`, migrated to this build's version: the
   * Postgres side of `createTestDatabases().open(definition).host`.
   */
  open(database: InstallDatabase): Promise<StoreHost>;
  /** Ends the task threads, closes the pool and drops the test database. */
  closeAll(): Promise<void>;
}

// The engine's task thread also serves the tasks the tests plant rows through.
const workers: Readonly<Record<InstallDatabase, URL>> = {
  engine: testEngineWorker,
  agent: agentWorker,
};
// Task threads run the TypeScript source, as the store's other worker tests do.
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const sharedSchema = "shared";

// Each call gets its own 30 s: one signal made once would bound the whole file.
function call(): AbortSignal {
  return AbortSignal.timeout(30_000);
}

/**
 * Opens a database of its own on the test server that `url` names (`inject("postgres")`), with
 * the shared schema prepared; each `open` adds an install. One task thread per database serves
 * every install of the file.
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
    const started =
      threads.get(name) ??
      startPostgresTaskThread({ worker: workers[name], execArgv, signal: call() });
    threads.set(name, started);
    return started;
  };
  let installs = 0;
  return {
    async open(name) {
      installs += 1;
      const digits = String(installs).padStart(12, "0");
      const installId = idSchema("ins").parse(`ins_0190f1c2-3a4b-7c5d-8e6f-${digits}`);
      await createPostgresInstall(database, { installId, sharedSchema }, call());
      const schema = installSchemas(installId)[name];
      return createPostgresStoreHost({ database, thread: await threadOf(name), schema });
    },
    async closeAll() {
      const started = await Promise.all(threads.values());
      await Promise.all(started.map(async (thread) => thread.close()));
      await database.close();
      await server.drop();
    },
  };
}
