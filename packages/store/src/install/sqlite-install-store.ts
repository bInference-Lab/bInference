import type { InstallStore } from "@binference/engine/install";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import {
  cancelRescueChangeTask,
  changeRescueTask,
  installIdTask,
  readInstallTask,
  setUpInstallTask,
} from "./install-tasks.js";

/** Every task of the SQLite install store. */
export const installTasks: readonly TaskRunner[] = [
  installIdTask,
  readInstallTask,
  setUpInstallTask,
  changeRescueTask,
  cancelRescueChangeTask,
];

/** The {@link InstallStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteInstallStore(host: StoreHost): InstallStore {
  const read = bindTask(host, readInstallTask);
  return {
    installId: bindTask(host, installIdTask),
    read: async (options) => read(null, options),
    setUp: bindTask(host, setUpInstallTask),
    changeRescue: bindTask(host, changeRescueTask),
    cancelRescueChange: bindTask(host, cancelRescueChangeTask),
  };
}
