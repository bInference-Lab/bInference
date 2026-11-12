import { type Id, idSchema } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { openPostgres, type PostgresDatabase } from "../postgres/open-postgres.js";
import { createTestPostgresDatabase, type TestPostgresDatabase } from "../testing/test-postgres.js";
import { agentPostgresMigrations } from "./agent-postgres/agent-postgres-migrations.js";
import { enginePostgresMigrations } from "./engine-postgres/engine-postgres-migrations.js";
import { installSchemas } from "./install-schemas.js";
import { createPostgresInstall, migratePostgresInstall } from "./postgres-install.js";
import { prepareSharedSchema } from "./prepare-shared-schema.js";
import type { MetaTables } from "./run-postgres-migrations.js";

const url = inject("postgres");
const never = new AbortController().signal;
const sharedSchema = "shared";

function installId(last: string): Id<"ins"> {
  return idSchema("ins").parse(`ins_0190f1c2-3a4b-7c5d-8e6f-${last.padStart(12, "0")}`);
}

type Database = PostgresDatabase<MetaTables>;

async function versionOf(database: Database, schema: string): Promise<string | undefined> {
  const row = await database.read(
    async ({ kysely, takeFirst }) =>
      takeFirst(
        kysely
          .withSchema(schema)
          .selectFrom("meta")
          .select("value")
          .where("key", "=", "schema_version"),
      ),
    never,
  );
  return row?.value;
}

// Every column of a schema with its type, collation, nullability and default, in a fixed order.
async function columnsOf(database: Database, schema: string): Promise<readonly string[]> {
  const rows = await database.read(
    async ({ kysely, execute }) =>
      execute(
        sql<{ column: string }>`select table_name || '.' || column_name || ' ' || data_type || ' '
            || coalesce(collation_name, '-') || ' ' || is_nullable || ' '
            || coalesce(column_default, '-') as column
          from information_schema.columns where table_schema = ${schema}
          order by table_name, ordinal_position`.compile(kysely),
      ),
    never,
  );
  return rows.rows.map((row) => row.column);
}

// Every lease row of an install, as the shared schema holds it.
async function leaseRowsOf(database: Database, install: Id<"ins">): Promise<readonly unknown[]> {
  const rows = await database.read(
    async ({ kysely, execute }) =>
      execute(
        sql`select agent_id, worker_id, fence, taken_at, renewed_at, expires_at
          from shared.agent_leases where install_id = ${install} order by agent_id`.compile(kysely),
      ),
    never,
  );
  return rows.rows;
}

describe.runIf(url !== "")("an install on Postgres", () => {
  let server: TestPostgresDatabase;
  let database: Database;

  beforeAll(async () => {
    server = await createTestPostgresDatabase(url);
    database = await openPostgres<MetaTables>(server.settings, {
      clock: { now: () => 0, sleep: async () => Promise.resolve() },
      random: createSeededRandom(3),
      logger: createMemoryLogger({ subsystem: "store" }),
      signal: never,
    });
    await prepareSharedSchema(database, sharedSchema, never);
  });

  afterAll(async () => {
    await database.close();
    await server.drop();
  });

  it("creates both schemas of an install at this build's versions", async () => {
    const schemas = await createPostgresInstall(
      database,
      { installId: installId("1"), sharedSchema },
      never,
    );
    expect(schemas).toStrictEqual(installSchemas(installId("1")));
    await expect(versionOf(database, schemas.engine)).resolves.toBe(
      String(enginePostgresMigrations.length),
    );
    await expect(versionOf(database, schemas.agent)).resolves.toBe(
      String(agentPostgresMigrations.length),
    );
  });

  it("refuses an install whose schemas exist and leaves them as they were", async () => {
    const install = { installId: installId("2"), sharedSchema };
    const schemas = await createPostgresInstall(database, install, never);
    await database.write(async ({ kysely, execute }) => {
      await execute(
        kysely
          .withSchema(schemas.engine)
          .insertInto("meta")
          .values({ key: "marker", value: "kept" }),
      );
    }, never);
    await expect(createPostgresInstall(database, install, never)).rejects.toMatchObject({
      code: "store.install_exists",
    });
    const marker = await database.read(
      async ({ kysely, takeFirst }) =>
        takeFirst(
          kysely
            .withSchema(schemas.engine)
            .selectFrom("meta")
            .select("value")
            .where("key", "=", "marker"),
        ),
      never,
    );
    expect(marker).toStrictEqual({ value: "kept" });
  });

  it("gives a new install its own lease row, free, which a second sign-up leaves alone", async () => {
    const install = { installId: installId("8"), sharedSchema };
    const free = {
      agent_id: "",
      worker_id: null,
      fence: 1,
      taken_at: null,
      renewed_at: null,
      expires_at: 0,
    };
    await createPostgresInstall(database, install, never);
    await expect(leaseRowsOf(database, install.installId)).resolves.toStrictEqual([free]);
    await expect(createPostgresInstall(database, install, never)).rejects.toMatchObject({
      code: "store.install_exists",
    });
    await expect(leaseRowsOf(database, install.installId)).resolves.toStrictEqual([free]);
  });

  it("refuses a text that is not an install id", async () => {
    await expect(
      database.write(async ({ kysely, execute }) => {
        await execute(sql`select shared.create_install('ins_not-an-id')`.compile(kysely));
      }, never),
    ).rejects.toMatchObject({ code: "store.postgres_failed", details: { sqlState: "22023" } });
  });

  it("lets no role run create_install without a grant", async () => {
    await expect(
      database.write(async ({ kysely, execute }) => {
        await execute(sql`create role nobody_granted`.compile(kysely));
        await execute(sql`grant usage on schema shared to nobody_granted`.compile(kysely));
        await execute(sql`set local role nobody_granted`.compile(kysely));
        await execute(sql`select shared.create_install(${installId("3")})`.compile(kysely));
      }, never),
    ).rejects.toMatchObject({ details: { sqlState: "42501" } });
  });

  it("applies nothing to an install at this build's versions", async () => {
    const install = { installId: installId("4"), sharedSchema };
    await createPostgresInstall(database, install, never);
    const report = await migratePostgresInstall(database, install, never);
    expect(report).toStrictEqual({
      engine: {
        from: enginePostgresMigrations.length,
        to: enginePostgresMigrations.length,
        applied: [],
      },
      agent: {
        from: agentPostgresMigrations.length,
        to: agentPostgresMigrations.length,
        applied: [],
      },
    });
  });

  it("migrates schemas from empty to the same tables create_install makes", async () => {
    const created = await createPostgresInstall(
      database,
      { installId: installId("5"), sharedSchema },
      never,
    );
    const migrated = installSchemas(installId("6"));
    const report = await migratePostgresInstall(
      database,
      { installId: installId("6"), sharedSchema },
      never,
    );
    expect(report.engine.applied).toStrictEqual(
      enginePostgresMigrations.map((migration) => migration.name),
    );
    expect(report.agent.applied).toStrictEqual(
      agentPostgresMigrations.map((migration) => migration.name),
    );
    await expect(columnsOf(database, migrated.engine)).resolves.toStrictEqual(
      await columnsOf(database, created.engine),
    );
    await expect(columnsOf(database, migrated.agent)).resolves.toStrictEqual(
      await columnsOf(database, created.agent),
    );
  });

  it("refuses a schema a newer build migrated", async () => {
    const install = { installId: installId("7"), sharedSchema };
    const schemas = await createPostgresInstall(database, install, never);
    const newer = String(enginePostgresMigrations.length + 1);
    await database.write(async ({ kysely, execute }) => {
      await execute(
        kysely
          .withSchema(schemas.engine)
          .updateTable("meta")
          .set({ value: newer })
          .where("key", "=", "schema_version"),
      );
    }, never);
    await expect(migratePostgresInstall(database, install, never)).rejects.toMatchObject({
      code: "store.newer_schema",
      details: { database: "engine", schemaVersion: Number(newer) },
    });
  });

  it("prepares the shared schema again without a change", async () => {
    await expect(prepareSharedSchema(database, sharedSchema, never)).resolves.toMatchObject({
      applied: [],
    });
  });
});
