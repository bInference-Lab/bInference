import {
  agentWorker,
  createSqliteChatDeletion,
  createSqliteChatQueueStore,
  createSqliteGoalStore,
  createSqliteHelperStore,
  createSqliteNoteStore,
  createSqliteSessionStore,
  createSqliteTranscriptStore,
  createSqliteWriterFence,
  type DatabaseHandle,
  openDatabase,
} from "@binference/store";
import type { AgentDatabase } from "./agent-database.js";

/**
 * The agent database's stores on an open, migrated `agent.sqlite` handle at `schemaVersion`; its
 * `close` closes the handle.
 */
export function agentDatabaseOn(handle: DatabaseHandle, schemaVersion: number): AgentDatabase {
  return {
    fence: createSqliteWriterFence(handle),
    sessions: createSqliteSessionStore(handle),
    transcript: createSqliteTranscriptStore(handle),
    queue: createSqliteChatQueueStore(handle),
    helpers: createSqliteHelperStore(handle),
    goals: createSqliteGoalStore(handle),
    notes: createSqliteNoteStore(handle),
    deletion: createSqliteChatDeletion(handle),
    schemaVersion,
    close: async () => handle.close(),
  };
}

/**
 * Opens `agent.sqlite` on the store's worker threads and migrates it (runtime spec, section 2.1).
 * A runtime started from source passes its loader options to the workers; a built one passes none.
 */
export async function openSqliteAgentDatabase(
  file: string,
  options: { readonly signal: AbortSignal; readonly execArgv: readonly string[] },
): Promise<AgentDatabase> {
  const { signal, execArgv } = options;
  const handle = await openDatabase({ file, worker: agentWorker, execArgv, signal });
  try {
    const migrated = await handle.migrate({ signal });
    return agentDatabaseOn(handle, migrated.to);
  } catch (error) {
    await handle.close();
    throw error;
  }
}
