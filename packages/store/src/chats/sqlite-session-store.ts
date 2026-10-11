import type { SessionStore } from "../ports.js";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { closeSessionTask, getSessionTask, openSessionTask } from "./session-tasks.js";
import {
  commitTurnTask,
  endTurnTask,
  getTurnTask,
  markOutsideTask,
  startTurnTask,
  unfinishedTurnsTask,
} from "./turn-tasks.js";

/** The {@link SessionStore} on `agent.sqlite`: each call runs one store task. */
export function createSqliteSessionStore(host: StoreHost): SessionStore {
  const unfinished = bindTask(host, unfinishedTurnsTask);
  return {
    open: bindTask(host, openSessionTask),
    get: bindTask(host, getSessionTask),
    close: bindTask(host, closeSessionTask),
    startTurn: bindTask(host, startTurnTask),
    commitTurn: bindTask(host, commitTurnTask),
    markOutside: bindTask(host, markOutsideTask),
    endTurn: bindTask(host, endTurnTask),
    turn: bindTask(host, getTurnTask),
    unfinishedTurns: async (options) => unfinished(null, options),
  };
}
