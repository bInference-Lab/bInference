import { BinferenceError } from "@binference/core";
import { sql } from "kysely";
import type { PostgresDatabase } from "../postgres/open-postgres.js";
import type { PostgresConnection } from "../postgres/postgres-connection.js";
import type { MigrationReport } from "./migration-report.js";
import type { PostgresMigration, PostgresMigrationPlan } from "./postgres-migration.js";
import { assertKnownVersion, latestVersion } from "./run-migrations.js";

/**
 * Where migrations apply: the schema they migrate, and the shared schema whose objects, such as
 * pg_trgm's operator classes, they may name unqualified. The shared schema migrates alone.
 */
export interface PostgresTarget {
  readonly schema: string;
  readonly plan: PostgresMigrationPlan;
  readonly sharedSchema?: string;
}

/** A schema's `meta`, which holds its schema version, as every migrated schema has it. */
export interface MetaTables {
  meta: { key: string; value: string };
}

const schemaName = /^[a-z][a-z0-9_]{0,62}$/;
const versionText = /^(?:0|[1-9]\d{0,8})$/;

function assertSchemaName(schema: string): void {
  if (!schemaName.test(schema)) {
    throw new BinferenceError({
      code: "store.bad_schema_name",
      message: `${JSON.stringify(schema)} is not a schema the store migrates: lowercase letters, digits and underscores, starting with a letter.`,
    });
  }
}

/** The schema version in `<schema>.meta`, or 0 for a schema no migration has touched. */
async function readPostgresSchemaVersion(
  connection: PostgresConnection<MetaTables>,
  schema: string,
): Promise<number> {
  const { kysely, takeFirst } = connection;
  const table = await takeFirst(
    sql<{ found: boolean }>`select to_regclass(${`${schema}.meta`}) is not null as found`.compile(
      kysely,
    ),
  );
  if (table?.found !== true) {
    return 0;
  }
  const row = await takeFirst(
    kysely
      .withSchema(schema)
      .selectFrom("meta")
      .select("value")
      .where("key", "=", "schema_version"),
  );
  if (row === undefined) {
    return 0;
  }
  if (!versionText.test(row.value)) {
    throw new BinferenceError({
      code: "store.bad_schema_version",
      message: `${schema}.meta.schema_version holds ${JSON.stringify(row.value)}, which is not a version; restore the schema from a backup.`,
    });
  }
  return Number(row.value);
}

// A transaction-scoped advisory lock keyed by the schema makes a second migrator wait, and the
// version is read again under it, so each migration and its version bump commit once.
async function applyMigration(
  connection: PostgresConnection<MetaTables>,
  target: PostgresTarget,
  step: { readonly migration: PostgresMigration; readonly version: number },
): Promise<boolean> {
  const { kysely, execute } = connection;
  const { schema } = target;
  await execute(
    sql`select pg_advisory_xact_lock(hashtext(${`binference.migrate.${schema}`}))`.compile(kysely),
  );
  if ((await readPostgresSchemaVersion(connection, schema)) >= step.version) {
    return false;
  }
  await execute(sql`create schema if not exists ${sql.id(schema)}`.compile(kysely));
  const path = [schema, ...(target.sharedSchema === undefined ? [] : [target.sharedSchema])];
  await execute(
    sql`select set_config('search_path', ${sql.lit(path.join(", "))}, true)`.compile(kysely),
  );
  await execute(sql.raw(step.migration.sql).compile(kysely));
  const value = String(step.version);
  await execute(
    kysely
      .withSchema(schema)
      .insertInto("meta")
      .values({ key: "schema_version", value })
      .onConflict((conflict) => conflict.column("key").doUpdateSet({ value })),
  );
  return true;
}

function migrationFault(
  migration: PostgresMigration,
  version: number,
  cause: Error["cause"],
): BinferenceError {
  return new BinferenceError({
    code: "store.migration_failed",
    message: `Migration ${migration.name} failed and rolled back whole; the schema stays at version ${String(version - 1)}.`,
    cause,
    details: {
      migration: migration.name,
      schemaVersion: version - 1,
      reason: cause instanceof Error ? cause.message : String(cause),
    },
  });
}

/**
 * Applies the migrations a Postgres schema lacks, each in its own write transaction with its
 * version bump in the schema's `meta`, creating the schema if it does not exist. A schema newer
 * than the plan throws `store.newer_schema`, as on SQLite; a failed migration rolls back whole and
 * throws `store.migration_failed`, and the migrations before it stay applied.
 */
export async function runPostgresMigrations(
  database: PostgresDatabase<MetaTables>,
  target: PostgresTarget,
  signal: AbortSignal,
): Promise<MigrationReport> {
  const { schema, plan } = target;
  assertSchemaName(schema);
  assertSchemaName(target.sharedSchema ?? schema);
  const latest = latestVersion(plan.migrations);
  const versionNow = async (): Promise<number> =>
    database.read(async (connection) => readPostgresSchemaVersion(connection, schema), signal);
  const from = await versionNow();
  assertKnownVersion(plan.name, from, latest);
  const applied: string[] = [];
  // Each migration waits for the one before it, so they apply in order.
  await plan.migrations.slice(from).reduce(async (before, migration, index) => {
    await before;
    const step = { migration, version: from + index + 1 };
    try {
      const write = async (connection: PostgresConnection<MetaTables>): Promise<boolean> =>
        applyMigration(connection, target, step);
      if (await database.write(write, signal)) {
        applied.push(migration.name);
      }
    } catch (error) {
      throw migrationFault(migration, step.version, error);
    }
  }, Promise.resolve());
  return { from, to: await versionNow(), applied };
}
