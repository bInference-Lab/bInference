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
import { addLaunchTicketTask, claimLaunchTask } from "./launch-tasks.js";
import { addPairCodeTask, usePairCodeTask } from "./pair-code-tasks.js";
import {
  addTokenTask,
  findTokenTask,
  listTokensTask,
  markTokenUsedTask,
  replaceRuntimeTokenTask,
  revokeTokenTask,
} from "./token-tasks.js";
import {
  dropWebPushSubscriptionTask,
  listWebPushSubscriptionsTask,
  saveWebPushSubscriptionTask,
} from "./web-push-tasks.js";

/** Every task of the SQLite access store. */
export const accessTasks: readonly TaskRunner[] = [
  addTokenTask,
  findTokenTask,
  listTokensTask,
  markTokenUsedTask,
  revokeTokenTask,
  replaceRuntimeTokenTask,
  addDeviceTask,
  findDeviceTask,
  listDevicesTask,
  markDeviceSeenTask,
  revokeDeviceTask,
  saveWebPushSubscriptionTask,
  listWebPushSubscriptionsTask,
  dropWebPushSubscriptionTask,
  addPairCodeTask,
  usePairCodeTask,
  claimLaunchTask,
  addLaunchTicketTask,
];

/** The {@link AccessStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteAccessStore(host: StoreHost): AccessStore {
  const listTokens = bindTask(host, listTokensTask);
  const listDevices = bindTask(host, listDevicesTask);
  const listSubscriptions = bindTask(host, listWebPushSubscriptionsTask);
  return {
    addToken: bindTask(host, addTokenTask),
    findToken: bindTask(host, findTokenTask),
    listTokens: async (options) => listTokens(null, options),
    markTokenUsed: bindTask(host, markTokenUsedTask),
    revokeToken: bindTask(host, revokeTokenTask),
    replaceRuntimeToken: bindTask(host, replaceRuntimeTokenTask),
    addDevice: bindTask(host, addDeviceTask),
    findDevice: bindTask(host, findDeviceTask),
    listDevices: async (options) => listDevices(null, options),
    markDeviceSeen: bindTask(host, markDeviceSeenTask),
    revokeDevice: bindTask(host, revokeDeviceTask),
    saveWebPushSubscription: bindTask(host, saveWebPushSubscriptionTask),
    listWebPushSubscriptions: async (options) => listSubscriptions(null, options),
    dropWebPushSubscription: bindTask(host, dropWebPushSubscriptionTask),
    addPairCode: bindTask(host, addPairCodeTask),
    usePairCode: bindTask(host, usePairCodeTask),
    claimLaunch: bindTask(host, claimLaunchTask),
    addLaunchTicket: bindTask(host, addLaunchTicketTask),
  };
}
