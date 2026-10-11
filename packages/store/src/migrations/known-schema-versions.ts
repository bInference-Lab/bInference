import { agentMigrations } from "./agent/agent-migrations.js";
import { engineMigrations } from "./engine/engine-migrations.js";
import { latestVersion } from "./run-migrations.js";

/** The newest schema version of each database this build knows. */
export interface SchemaVersions {
  readonly engine: number;
  readonly agent: number;
}

/**
 * The newest schema version of `engine.sqlite` and `agent.sqlite` this build migrates to, read
 * from its migrations without opening a database: what a restore compares a backup's versions
 * with before it puts a file in place.
 */
export function knownSchemaVersions(): SchemaVersions {
  return { engine: latestVersion(engineMigrations), agent: latestVersion(agentMigrations) };
}
