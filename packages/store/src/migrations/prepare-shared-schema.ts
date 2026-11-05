import { sql } from "kysely";
import type { PostgresDatabase } from "../postgres/open-postgres.js";
import { agentPostgresMigrations } from "./agent-postgres/agent-postgres-migrations.js";
import { createInstallFunctionSql } from "./create-install-function.js";
import { enginePostgresMigrations } from "./engine-postgres/engine-postgres-migrations.js";
import type { MigrationReport } from "./migration-report.js";
import { type MetaTables, runPostgresMigrations } from "./run-postgres-migrations.js";
import { sharedPostgresMigrations } from "./shared-postgres/shared-postgres-migrations.js";

/**
 * Brings the shared schema to this build's version, then replaces its `create_install` with one
 * that applies this build's engine and agent migrations. A deploy runs it as the role that owns
 * the shared schema, before it migrates the installs.
 */
export async function prepareSharedSchema(
  database: PostgresDatabase<MetaTables>,
  sharedSchema: string,
  signal: AbortSignal,
): Promise<MigrationReport> {
  const report = await runPostgresMigrations(
    database,
    { schema: sharedSchema, plan: { name: "shared", migrations: sharedPostgresMigrations } },
    signal,
  );
  const definition = createInstallFunctionSql(sharedSchema, {
    engine: enginePostgresMigrations,
    agent: agentPostgresMigrations,
  });
  await database.write(async ({ kysely, execute }) => {
    await execute(sql.raw(definition).compile(kysely));
  }, signal);
  return report;
}
