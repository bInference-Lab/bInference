// The agent database with the tasks store tests read and write its rows through, for the Postgres
// test stores' task thread. Nothing in production uses this file.
import { agentDatabase } from "../databases/agent-database.js";
import { type DatabaseDefinition, workerUrl } from "../databases/database-definition.js";
import { changeEventTask, readAgentRowsTask, removeEventsTask } from "./agent-rows.js";

/** The agent database's definition, plus the row tasks of the store tests. */
export const testAgentDatabase: DatabaseDefinition = {
  ...agentDatabase,
  tasks: [...agentDatabase.tasks, readAgentRowsTask, changeEventTask, removeEventsTask],
};

/** The worker entry that serves {@link testAgentDatabase}. */
export const testAgentWorker: URL = workerUrl(import.meta.url, "test-agent");
