import type { InstallStore } from "@binference/engine/install";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import {
  cancelRescueChangeTask,
  changeRescueTask,
  clearRescueCeilingTask,
  createWalletTask,
  installIdTask,
  keepRescueCeilingTask,
  readInstallTask,
  setUpInstallTask,
  updateCeilingTask,
} from "./install-tasks.js";

/** Every task of the SQLite install store. */
export const installTasks: readonly TaskRunner[] = [
  installIdTask,
  readInstallTask,
  setUpInstallTask,
  changeRescueTask,
  cancelRescueChangeTask,
  clearRescueCeilingTask,
  keepRescueCeilingTask,
  createWalletTask,
  updateCeilingTask,
];

/** The {@link InstallStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteInstallStore(host: StoreHost): InstallStore {
  const read = bindTask(host, readInstallTask);
  const clearRescue = bindTask(host, clearRescueCeilingTask);
  const keepRescue = bindTask(host, keepRescueCeilingTask);
  const createWallet = bindTask(host, createWalletTask);
  return {
    installId: bindTask(host, installIdTask),
    read: async (options) => read(null, options),
    setUp: bindTask(host, setUpInstallTask),
    changeRescue: bindTask(host, changeRescueTask),
    cancelRescueChange: bindTask(host, cancelRescueChangeTask),
    clearRescueCeiling: async (options) => {
      await clearRescue(null, options);
    },
    keepRescueCeiling: async (ceiling, options) => {
      await keepRescue(ceiling, options);
    },
    createWallet: async (wallet, options) => {
      await createWallet(wallet, options);
    },
    updateCeiling: bindTask(host, updateCeilingTask),
  };
}
