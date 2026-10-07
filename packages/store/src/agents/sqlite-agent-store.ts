import type { AgentStore } from "@binference/engine";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import { createAgentTask, getAgentTask, listAgentsTask } from "./agent-tasks.js";
import { setApprovalModeTask, setLimitsTask, setModeTask } from "./settings-tasks.js";

/** Every task of the SQLite agent store. */
export const agentTasks: readonly TaskRunner[] = [
  createAgentTask,
  getAgentTask,
  listAgentsTask,
  setApprovalModeTask,
  setLimitsTask,
  setModeTask,
];

/** The {@link AgentStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteAgentStore(host: StoreHost): AgentStore {
  const list = bindTask(host, listAgentsTask);
  return {
    create: bindTask(host, createAgentTask),
    get: bindTask(host, getAgentTask),
    list: async (options) => list(null, options),
    setApprovalMode: bindTask(host, setApprovalModeTask),
    setLimits: bindTask(host, setLimitsTask),
    setMode: bindTask(host, setModeTask),
  };
}
