// A real `agent.sqlite` for other packages' tests, on workers that also serve the row tasks of
// the tests. Nothing in production uses this file.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DatabaseHandle, openDatabase } from "../host/open-database.js";
import { testAgentWorker } from "./test-agent-database.js";

/** A migrated `agent.sqlite` in a folder of its own. */
export interface TestAgentSqlite {
  readonly handle: DatabaseHandle;
  readonly schemaVersion: number;
  /** Closes the handle, then removes its folder. */
  close(): Promise<void>;
}

// Workers run the TypeScript source, as in the store's own tests.
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];

/**
 * Opens and migrates an `agent.sqlite` in a fresh folder under the OS temp folder, on workers that
 * run the TypeScript source and serve the test row tasks, such as `setQueuedPayloadTextTask`.
 */
export async function openTestAgentSqlite(options: {
  readonly signal: AbortSignal;
}): Promise<TestAgentSqlite> {
  const folder = mkdtempSync(join(tmpdir(), "bnf-agent-"));
  const file = join(folder, "agent.sqlite");
  const handle = await openDatabase({ file, worker: testAgentWorker, execArgv, ...options });
  // Every connection closes before the folder goes: Windows refuses to delete an open file.
  const close = async (): Promise<void> => {
    await handle.close();
    rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  };
  try {
    const migrated = await handle.migrate(options);
    return { handle, schemaVersion: migrated.to, close };
  } catch (error) {
    await close();
    throw error;
  }
}
