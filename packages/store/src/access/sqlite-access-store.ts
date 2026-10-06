import type { AccessStore } from "@binference/engine";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import {
  addDeviceTask,
  findDeviceTask,
  listDevicesTask,
  markDeviceSeenTask,
  revokeDeviceTask,
} from "./device-tasks.js";
import { addPairCodeTask, usePairCodeTask } from "./pair-code-tasks.js";
import {
  addTokenTask,
  findTokenTask,
  listTokensTask,
  markTokenUsedTask,
  revokeTokenTask,
} from "./token-tasks.js";

/** Every task of the SQLite access store. */
export const accessTasks: readonly TaskRunner[] = [
  addTokenTask,
  findTokenTask,
  listTokensTask,
  markTokenUsedTask,
  revokeTokenTask,
  addDeviceTask,
  findDeviceTask,
  listDevicesTask,
  markDeviceSeenTask,
  revokeDeviceTask,
  addPairCodeTask,
  usePairCodeTask,
];

/** The {@link AccessStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteAccessStore(host: StoreHost): AccessStore {
  const listTokens = bindTask(host, listTokensTask);
  const listDevices = bindTask(host, listDevicesTask);
  return {
    addToken: bindTask(host, addTokenTask),
    findToken: bindTask(host, findTokenTask),
    listTokens: async (options) => listTokens(null, options),
    markTokenUsed: bindTask(host, markTokenUsedTask),
    revokeToken: bindTask(host, revokeTokenTask),
    addDevice: bindTask(host, addDeviceTask),
    findDevice: bindTask(host, findDeviceTask),
    listDevices: async (options) => listDevices(null, options),
    markDeviceSeen: bindTask(host, markDeviceSeenTask),
    revokeDevice: bindTask(host, revokeDeviceTask),
    addPairCode: bindTask(host, addPairCodeTask),
    usePairCode: bindTask(host, usePairCodeTask),
  };
}
