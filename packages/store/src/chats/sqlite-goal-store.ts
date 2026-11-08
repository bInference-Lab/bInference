import type { GoalStore } from "../ports.js";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import {
  activeGoalsTask,
  clearGoalTask,
  getGoalTask,
  getProgressNoteTask,
  putProgressNoteTask,
  setGoalTask,
  writeGoalTask,
} from "./goal-tasks.js";

/** The {@link GoalStore} on `agent.sqlite`: each call runs one store task. */
export function createSqliteGoalStore(host: StoreHost): GoalStore {
  const active = bindTask(host, activeGoalsTask);
  return {
    get: bindTask(host, getGoalTask),
    active: async (options) => active(null, options),
    set: bindTask(host, setGoalTask),
    write: bindTask(host, writeGoalTask),
    clear: bindTask(host, clearGoalTask),
    note: bindTask(host, getProgressNoteTask),
    putNote: bindTask(host, putProgressNoteTask),
  };
}
