import { openConnection } from "./open-connection.worker.js";

// A table no release makes, so a database that holds it is plainly one of these tests'.
const newerStep = `
CREATE TABLE newer_release_rows (id INTEGER PRIMARY KEY);
UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'schema_version';
`;

/**
 * For tests: migrates a database one schema version past this build, as a newer release's
 * migration does, with a table of its own; this build then refuses to open it
 * (`store.newer_schema`). The file may be open in an engine meanwhile, as a newer engine's is
 * while it migrates.
 */
export function migratePastThisBuild(file: string): void {
  const database = openConnection(file, { role: "writer", synchronous: "full" });
  try {
    database.exec(newerStep);
  } finally {
    database.close();
  }
}
