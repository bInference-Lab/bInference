import { raiseFenceTask } from "../chats/fence-tasks.js";
import {
  addQueuedTask,
  dropQueuedTask,
  takeQueuedTask,
  waitingTask,
} from "../chats/queue-tasks.js";
import { pruneChatsTask } from "../chats/retention-tasks.js";
import { closeSessionTask, getSessionTask, openSessionTask } from "../chats/session-tasks.js";
import {
  appendCommittingTask,
  appendEventsTask,
  listEventsTask,
} from "../chats/transcript-tasks.js";
import {
  commitTurnTask,
  endTurnTask,
  getTurnTask,
  markOutsideTask,
  startTurnTask,
  unfinishedTurnsTask,
} from "../chats/turn-tasks.js";
import { agentMigrations } from "../migrations/agent/agent-migrations.js";
import {
  deleteNoteTask,
  listNotesTask,
  searchNotesTask,
  writeNoteTask,
} from "../notes/note-tasks.js";
import { clearAgentStateTask } from "../reset/reset-tasks.js";
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
    appendCommittingTask,
    listEventsTask,
    addQueuedTask,
    waitingTask,
    takeQueuedTask,
    dropQueuedTask,
    writeNoteTask,
    deleteNoteTask,
    listNotesTask,
    searchNotesTask,
    pruneChatsTask,
    clearAgentStateTask,
  ],
};

/** The agent database's worker entry, for `openDatabase`. */
export const agentWorker: URL = workerUrl(import.meta.url, "agent");
