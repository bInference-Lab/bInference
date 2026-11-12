import { type Id, idSchema } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { agentLeasesContract } from "../contracts/agent-leases-contract.js";
import type { LeaseRow } from "../leases/agent-leases.js";
import { createPostgresInstall } from "../migrations/postgres-install.js";
import { prepareSharedSchema } from "../migrations/prepare-shared-schema.js";
import type { MetaTables } from "../migrations/run-postgres-migrations.js";
import { createTestPostgresDatabase, type TestPostgresDatabase } from "../testing/test-postgres.js";
import { openPostgres, type PostgresDatabase } from "./open-postgres.js";
import { createPostgresAgentLeases } from "./postgres-agent-leases.js";

const url = inject("postgres");
const never = new AbortController().signal;
const sharedSchema = "shared";
// Short, so a check waits a lease out in about half a second.
const leaseMs = 500;

describe.runIf(url !== "")("agent leases on Postgres", () => {
  let server: TestPostgresDatabase;
  let database: PostgresDatabase<MetaTables>;
  let installs = 0;

  beforeAll(async () => {
    server = await createTestPostgresDatabase(url);
    database = await openPostgres<MetaTables>(server.settings, {
      clock: { now: () => 0, sleep: async () => Promise.resolve() },
      random: createSeededRandom(11),
      logger: createMemoryLogger({ subsystem: "store" }),
      signal: never,
    });
    await prepareSharedSchema(database, sharedSchema, never);
  });

  afterAll(async () => {
    await database.close();
    await server.drop();
  });

  // The rows and the clock read here on their own, apart from the adapter's reads of them.
  const rowsOf = async (installId: Id<"ins">): Promise<readonly LeaseRow[]> =>
    database.read(async ({ kysely, execute }) => {
      const { rows } = await execute(
        sql<LeaseRow>`select agent_id as "agentId", worker_id as "workerId", fence,
            taken_at as "takenAtMs", renewed_at as "renewedAtMs", expires_at as "expiresAtMs"
          from shared.agent_leases where install_id = ${installId} order by agent_id`.compile(
          kysely,
        ),
      );
      return rows;
    }, never);
  const nowOf = async (): Promise<number> =>
    database.read(async ({ kysely, takeFirst }) => {
      const row = await takeFirst(
        sql<{ now: number }>`select floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          as now`.compile(kysely),
      );
      return row?.now ?? Number.NaN;
    }, never);

  it.each(
    agentLeasesContract({
      create: async () => {
        installs += 1;
        const digits = String(installs).padStart(12, "0");
        const installId = idSchema("ins").parse(`ins_0190f1c2-3a4b-7c5d-8e6f-${digits}`);
        await createPostgresInstall(database, { installId, sharedSchema }, never);
        return {
          leases: createPostgresAgentLeases({ database, sharedSchema, leaseMs }),
          installId,
          leaseMs,
          now: nowOf,
          passes: async (ms) => {
            await database.read(async ({ kysely, execute }) => {
              await execute(sql`select pg_sleep(${ms / 1_000})`.compile(kysely));
            }, never);
          },
          rows: async () => rowsOf(installId),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
