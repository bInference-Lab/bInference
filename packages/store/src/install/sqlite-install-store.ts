import type { InstallStore } from "@binference/engine/install";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import { attachTask, setSealKeyTask } from "./attach-task.js";
import { acceptDisclaimerTask } from "./disclaimer-task.js";
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
import { keepRescueReachTask } from "./rescue-reach-task.js";

/** Every task of the SQLite install store. */
export const installTasks: readonly TaskRunner[] = [
  installIdTask,
  readInstallTask,
  setUpInstallTask,
  changeRescueTask,
  cancelRescueChangeTask,
  clearRescueCeilingTask,
  keepRescueCeilingTask,
  keepRescueReachTask,
  createWalletTask,
  updateCeilingTask,
  attachTask,
  setSealKeyTask,
  acceptDisclaimerTask,
];

/** The {@link InstallStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteInstallStore(host: StoreHost): InstallStore {
  const read = bindTask(host, readInstallTask);
  const clearRescue = bindTask(host, clearRescueCeilingTask);
  const keepRescue = bindTask(host, keepRescueCeilingTask);
  const keepReach = bindTask(host, keepRescueReachTask);
  const createWallet = bindTask(host, createWalletTask);
  const acceptDisclaimer = bindTask(host, acceptDisclaimerTask);
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
    keepRescueReach: async (reach, options) => {
      await keepReach(reach, options);
    },
    createWallet: async (wallet, options) => {
      await createWallet(wallet, options);
    },
    updateCeiling: bindTask(host, updateCeilingTask),
    attach: bindTask(host, attachTask),
    setSealKey: bindTask(host, setSealKeyTask),
    acceptDisclaimer: async (acceptance, options) => {
      await acceptDisclaimer(acceptance, options);
    },
  };
}
