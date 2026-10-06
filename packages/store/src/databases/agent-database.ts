import { agentMigrations } from "../migrations/agent/agent-migrations.js";
import { workerUrl, type DatabaseDefinition } from "./database-definition.js";

/** `agent.sqlite`: sessions, transcripts and notes. `synchronous=NORMAL`. */
export const agentDatabase: DatabaseDefinition = {
  name: "agent",
  synchronous: "normal",
  migrations: agentMigrations,
  tasks: [],
};

/** The agent database's worker entry, for `openDatabase`. */
export const agentWorker: URL = workerUrl(import.meta.url, "agent");
