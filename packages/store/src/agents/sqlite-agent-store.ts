import type { AgentStore } from "@binference/engine";
import { quotaWriteOf } from "../tasks/quota-write.js";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import { addAddressTask, removeAddressTask } from "./address-book-tasks.js";
import { createAgentTask, getAgentTask, listAgentsTask } from "./agent-tasks.js";
import { setModeTask } from "./mode-tasks.js";
import {
  setApprovalModeTask,
  setLimitsTask,
  setModelsTask,
  setNotificationsTask,
  setSendLevelTask,
} from "./settings-tasks.js";

/** Every task of the SQLite agent store. */
export const agentTasks: readonly TaskRunner[] = [
  createAgentTask,
  getAgentTask,
  listAgentsTask,
  setApprovalModeTask,
  setLimitsTask,
  setModeTask,
  setModelsTask,
  setNotificationsTask,
  setSendLevelTask,
  addAddressTask,
  removeAddressTask,
];

/** The {@link AgentStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteAgentStore(host: StoreHost): AgentStore {
  const list = bindTask(host, listAgentsTask);
  const create = bindTask(host, createAgentTask);
  const setMode = bindTask(host, setModeTask);
  return {
    create: async (draft, call) => create(quotaWriteOf(draft, call), { signal: call.signal }),
    get: bindTask(host, getAgentTask),
    list: async (options) => list(null, options),
    setApprovalMode: bindTask(host, setApprovalModeTask),
    setLimits: bindTask(host, setLimitsTask),
    setMode: async (change, call) => setMode(quotaWriteOf(change, call), { signal: call.signal }),
    setModels: bindTask(host, setModelsTask),
    setNotifications: bindTask(host, setNotificationsTask),
    setSendLevel: bindTask(host, setSendLevelTask),
    addAddress: bindTask(host, addAddressTask),
    removeAddress: bindTask(host, removeAddressTask),
  };
}
