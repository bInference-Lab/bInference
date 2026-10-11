import { raiseFenceTask } from "../chats/fence-tasks.js";
import { closeSessionTask, getSessionTask, openSessionTask } from "../chats/session-tasks.js";
import { appendEventsTask, listEventsTask } from "../chats/transcript-tasks.js";
import {
  commitTurnTask,
  endTurnTask,
  getTurnTask,
  markOutsideTask,
  startTurnTask,
  unfinishedTurnsTask,
} from "../chats/turn-tasks.js";
import { agentMigrations } from "../migrations/agent/agent-migrations.js";
import { workerUrl, type DatabaseDefinition } from "./database-definition.js";

/** `agent.sqlite`: sessions, transcripts and notes. `synchronous=NORMAL`. */
export const agentDatabase: DatabaseDefinition = {
  name: "agent",
  synchronous: "normal",
  migrations: agentMigrations,
  tasks: [
    raiseFenceTask,
    openSessionTask,
    getSessionTask,
    closeSessionTask,
    startTurnTask,
    commitTurnTask,
    markOutsideTask,
    endTurnTask,
    getTurnTask,
    unfinishedTurnsTask,
    appendEventsTask,
    listEventsTask,
  ],
};

/** The agent database's worker entry, for `openDatabase`. */
export const agentWorker: URL = workerUrl(import.meta.url, "agent");
