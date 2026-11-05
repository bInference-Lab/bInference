import { BinferenceError, type Id } from "@binference/core";
import { sql } from "kysely";
import type { PostgresDatabase } from "../postgres/open-postgres.js";
import { sqlStateOf } from "../postgres/postgres-error.js";
import { agentPostgresMigrations } from "./agent-postgres/agent-postgres-migrations.js";
import { enginePostgresMigrations } from "./engine-postgres/engine-postgres-migrations.js";
import { type InstallSchemas, installSchemas } from "./install-schemas.js";
import type { MigrationReport } from "./migration-report.js";
import { type MetaTables, runPostgresMigrations } from "./run-postgres-migrations.js";

/** An install in a database whose shared schema `prepareSharedSchema` brought up to date. */
export interface PostgresInstall {
  readonly installId: Id<"ins">;
  readonly sharedSchema: string;
}

/**
 * Creates an install's two schemas through the shared schema's `create_install`, each migrated to
 * this build's version. An install whose schemas exist is refused with `store.install_exists`, so
 * a second sign-up never touches it.
 */
export async function createPostgresInstall(
  database: PostgresDatabase<MetaTables>,
  install: PostgresInstall,
  signal: AbortSignal,
): Promise<InstallSchemas> {
  try {
    await database.write(async ({ kysely, execute }) => {
      await execute(
        sql`select ${sql.id(install.sharedSchema, "create_install")}(${install.installId})`.compile(
          kysely,
        ),
      );
    }, signal);
  } catch (error) {
    if (error instanceof BinferenceError && sqlStateOf(error.cause) === "42P06") {
      throw new BinferenceError({
        code: "store.install_exists",
        message: `The schemas of install ${install.installId} exist already; it was not changed.`,
        cause: error,
        details: { installId: install.installId },
      });
    }
    throw error;
  }
  return installSchemas(install.installId);
}

/** What migrating an install did to each of its schemas. */
export interface InstallMigrationReport {
  readonly engine: MigrationReport;
  readonly agent: MigrationReport;
}

/**
 * Applies the migrations an install's schemas lack, as a deploy does for every install. A schema
 * newer than this build throws `store.newer_schema`.
 */
export async function migratePostgresInstall(
  database: PostgresDatabase<MetaTables>,
  install: PostgresInstall,
  signal: AbortSignal,
): Promise<InstallMigrationReport> {
  const schemas = installSchemas(install.installId);
  const { sharedSchema } = install;
  const engine = await runPostgresMigrations(
    database,
    {
      schema: schemas.engine,
      plan: { name: "engine", migrations: enginePostgresMigrations },
      sharedSchema,
    },
    signal,
  );
  const agent = await runPostgresMigrations(
    database,
    {
      schema: schemas.agent,
      plan: { name: "agent", migrations: agentPostgresMigrations },
      sharedSchema,
    },
    signal,
  );
  return { engine, agent };
}
