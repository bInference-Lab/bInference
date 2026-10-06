import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Migration } from "../migrations/migration.js";
import type { Synchronous } from "../sqlite/open-connection.worker.js";
import type { TaskRunner } from "../tasks/store-task.js";

/** One database as its store workers serve it. Its worker entry passes it to `serveDatabase`. */
export interface DatabaseDefinition {
  /** `engine` or `agent`; errors and reports name the database by it. */
  readonly name: string;
  readonly synchronous: Synchronous;
  /** Every migration, oldest first; the newest one's number is the schema version. */
  readonly migrations: readonly Migration[];
  /** Every task the main thread may run on this database. */
  readonly tasks: readonly TaskRunner[];
}

/**
 * The URL of the worker entry `<name>.worker` beside the module at `moduleUrl`: a `.ts` file in
 * the source, a `.mjs` file in the build, which keeps the source layout.
 */
export function workerUrl(moduleUrl: string, name: string): URL {
  return new URL(`./${name}.worker${extname(fileURLToPath(moduleUrl))}`, moduleUrl);
}
