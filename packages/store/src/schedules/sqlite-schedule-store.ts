import type { ScheduleStore } from "@binference/engine/chat";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import { runScheduleTask } from "./schedule-run-task.js";
import {
  activeSchedulesTask,
  cancelScheduleTask,
  createScheduleTask,
  dueSchedulesTask,
  getScheduleTask,
  rezoneScheduleTask,
} from "./schedule-tasks.js";

/** The schedule store's tasks, which `engine.sqlite`'s workers serve. */
export const scheduleTasks: readonly TaskRunner[] = [
  createScheduleTask,
  getScheduleTask,
  activeSchedulesTask,
  dueSchedulesTask,
  cancelScheduleTask,
  rezoneScheduleTask,
  runScheduleTask,
];

/** The {@link ScheduleStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteScheduleStore(host: StoreHost): ScheduleStore {
  return {
    create: bindTask(host, createScheduleTask),
    get: bindTask(host, getScheduleTask),
    active: bindTask(host, activeSchedulesTask),
    due: bindTask(host, dueSchedulesTask),
    cancel: bindTask(host, cancelScheduleTask),
    rezone: bindTask(host, rezoneScheduleTask),
    run: bindTask(host, runScheduleTask),
  };
}
