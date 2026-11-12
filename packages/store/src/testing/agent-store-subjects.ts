// The subjects of the agent database's own suites on a fresh agent database's host, its rows read
// and written through its tasks, so one setup serves the SQLite and Postgres tests. Nothing in
// production uses this file.
import { createSqliteChatQueueStore } from "../chats/sqlite-chat-queue-store.js";
import { createSqliteChatRetention } from "../chats/sqlite-chat-retention.js";
import { createSqliteGoalStore } from "../chats/sqlite-goal-store.js";
import { createSqliteHelperStore } from "../chats/sqlite-helper-store.js";
import { createSqliteSessionStore } from "../chats/sqlite-session-store.js";
import { createSqliteTranscriptStore } from "../chats/sqlite-transcript-store.js";
import { createSqliteWriterFence } from "../chats/sqlite-writer-fence.js";
import type { AgentTablesSubject } from "../contracts/agent-tables-contract.js";
import { createSqliteNoteStore } from "../notes/sqlite-note-store.js";
import type { StoreHost } from "../tasks/store-host.js";
import { agentRowsOn, changeEventOn, removeEventsOn } from "./agent-rows.js";

/** The agent tables' subject: every agent store bound to `host`, and its rows through its tasks. */
export function agentTablesSubject(host: StoreHost): AgentTablesSubject {
  return {
    sessions: createSqliteSessionStore(host),
    transcript: createSqliteTranscriptStore(host),
    retention: createSqliteChatRetention(host),
    queue: createSqliteChatQueueStore(host),
    helpers: createSqliteHelperStore(host),
    goals: createSqliteGoalStore(host),
    notes: createSqliteNoteStore(host),
    fence: createSqliteWriterFence(host),
    rows: async () => agentRowsOn(host),
    changeEvent: async (id) => changeEventOn(host, id),
    removeEvents: async (session) => removeEventsOn(host, session),
  };
}
