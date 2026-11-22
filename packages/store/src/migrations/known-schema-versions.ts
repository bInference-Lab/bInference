import { agentMigrations } from "./agent/agent-migrations.js";
import { engineMigrations } from "./engine/engine-migrations.js";
import { latestVersion } from "./run-migrations.js";

/**
 * The oldest schema version of `engine.sqlite` an update to this build may start from: the backup
 * before a migration reads every database from this version on, so its store tasks name only the
 * columns this version holds. The first published release raises it to its own schema version;
 * it only ever rises.
 */
export const oldestUpdatedEngineSchemaVersion = 64;

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
