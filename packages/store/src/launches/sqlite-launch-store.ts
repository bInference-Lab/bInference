import type { LaunchStore } from "@binference/engine/market";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import { launchCursorTask, listLaunchesTask, recordLaunchReadTask } from "./launch-tasks.js";

/** The launch store's tasks, which `engine.sqlite`'s workers serve. */
export const launchTasks: readonly TaskRunner[] = [
  launchCursorTask,
  recordLaunchReadTask,
  listLaunchesTask,
];

/** The {@link LaunchStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteLaunchStore(host: StoreHost): LaunchStore {
  return {
    cursor: bindTask(host, launchCursorTask),
    record: bindTask(host, recordLaunchReadTask),
    list: bindTask(host, listLaunchesTask),
  };
}
