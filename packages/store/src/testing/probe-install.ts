// The probe database in an install's engine schema, beside the install's lease rows, for the
// Postgres store host's own tests. Nothing in production uses this file.
import type { Id } from "@binference/core";
import { nthId } from "../contracts/agent-fixtures.js";
import { installSchemas } from "../migrations/install-schemas.js";
import { createPostgresInstall } from "../migrations/postgres-install.js";
import type { PostgresMigrationPlan } from "../migrations/postgres-migration.js";
import { type MetaTables, runPostgresMigrations } from "../migrations/run-postgres-migrations.js";
import type { PostgresDatabase } from "../postgres/open-postgres.js";

// The probe database's tables in their Postgres form.
const probePostgresPlan: PostgresMigrationPlan = {
  name: "probe",
  migrations: [
    {
      name: "0001_meta",
      sql: 'create table meta (key text collate "C" primary key, value text collate "C" not null)',
    },
    {
      name: "0002_probe_tables",
      sql: `create table probe_writes (id bigserial primary key, writer bigint not null,
          seq bigint not null, unique (writer, seq));
        create table probe_counter (id bigint primary key, value bigint not null);
        insert into probe_counter values (1, 0);`,
    },
  ],
};

/** An install whose engine schema holds the probe tables in place of the engine's. */
export interface ProbeInstall {
  readonly installId: Id<"ins">;
  /** The install's engine schema, which the probe tasks run on. */
  readonly schema: string;
}

/**
 * Makes install `n` through `create_install`, so its lease rows are the ones a sign-up makes, then
 * puts the probe tables in its engine schema. The shared schema must be prepared.
 */
export async function createProbeInstall(
  database: PostgresDatabase<MetaTables>,
  install: { readonly sharedSchema: string; readonly n: number },
  signal: AbortSignal,
): Promise<ProbeInstall> {
  const installId = nthId("ins", install.n);
  await createPostgresInstall(database, { installId, sharedSchema: install.sharedSchema }, signal);
  const schema = installSchemas(installId).engine;
  await database.write(async ({ kysely, execute }) => {
    await execute(kysely.schema.dropSchema(schema).cascade());
  }, signal);
  await runPostgresMigrations(database, { schema, plan: probePostgresPlan }, signal);
  return { installId, schema };
}
