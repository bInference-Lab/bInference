import { deleteChatsTask } from "../chats/deletion-tasks.js";
import { raiseFenceTask } from "../chats/fence-tasks.js";
import {
  activeGoalsTask,
  clearGoalTask,
  getGoalTask,
  getProgressNoteTask,
  putProgressNoteTask,
  setGoalTask,
  writeGoalTask,
} from "../chats/goal-tasks.js";
import {
  getHelperTask,
  listHelpersTask,
  moveHelperTask,
  startHelperTask,
} from "../chats/helper-tasks.js";
import {
  addQueuedTask,
  dropQueuedTask,
  takeQueuedTask,
  waitingTask,
} from "../chats/queue-tasks.js";
import { pruneChatsTask } from "../chats/retention-tasks.js";
import {
  closeSessionTask,
  countTurnsTask,
  getSessionTask,
  openSessionTask,
  setSessionModelTask,
} from "../chats/session-tasks.js";
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
    setSessionModelTask,
    countTurnsTask,
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
    startHelperTask,
    getHelperTask,
    listHelpersTask,
    moveHelperTask,
    getGoalTask,
    activeGoalsTask,
    setGoalTask,
    writeGoalTask,
    clearGoalTask,
    getProgressNoteTask,
    putProgressNoteTask,
    writeNoteTask,
    deleteNoteTask,
    listNotesTask,
    searchNotesTask,
    pruneChatsTask,
    deleteChatsTask,
    clearAgentStateTask,
  ],
};

/** The agent database's worker entry, for `openDatabase`. */
export const agentWorker: URL = workerUrl(import.meta.url, "agent");
