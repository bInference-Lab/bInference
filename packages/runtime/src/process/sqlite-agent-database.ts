import {
  agentWorker,
  createSqliteChatQueueStore,
  createSqliteNoteStore,
  createSqliteSessionStore,
  createSqliteTranscriptStore,
  createSqliteWriterFence,
  openDatabase,
} from "@binference/store";
import type { AgentDatabase } from "./agent-database.js";

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
    return {
      fence: createSqliteWriterFence(handle),
      sessions: createSqliteSessionStore(handle),
      transcript: createSqliteTranscriptStore(handle),
      queue: createSqliteChatQueueStore(handle),
      notes: createSqliteNoteStore(handle),
      schemaVersion: migrated.to,
      close: async () => handle.close(),
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
