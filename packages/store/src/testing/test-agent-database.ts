// The agent database with the tasks tests read and write its rows through, for the Postgres test
// stores' task thread and for a SQLite file other packages' tests plant rows in. Nothing in
// production uses this file.
import { agentDatabase } from "../databases/agent-database.js";
import { type DatabaseDefinition, workerUrl } from "../databases/database-definition.js";
import { changeEventTask, readAgentRowsTask, removeEventsTask } from "./agent-rows.js";
import { setQueuedPayloadTextTask } from "./old-queued-payload.js";

/** The agent database's definition, plus the row tasks of the tests. */
export const testAgentDatabase: DatabaseDefinition = {
  ...agentDatabase,
  tasks: [
    ...agentDatabase.tasks,
    readAgentRowsTask,
    changeEventTask,
    removeEventsTask,
    setQueuedPayloadTextTask,
  ],
};

/** The worker entry that serves {@link testAgentDatabase}. */
export const testAgentWorker: URL = workerUrl(import.meta.url, "test-agent");
