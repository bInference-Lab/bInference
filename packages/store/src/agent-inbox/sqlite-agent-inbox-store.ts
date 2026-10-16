import type { AgentInboxStore } from "@binference/engine/chat";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import {
  addInboxMessageTask,
  getInboxMessageTask,
  openSessionTask,
  takeMessagesTask,
  untakenMessagesTask,
} from "./agent-inbox-tasks.js";

/** The agent inbox's tasks, which `engine.sqlite`'s workers serve. */
export const agentInboxTasks: readonly TaskRunner[] = [
  addInboxMessageTask,
  getInboxMessageTask,
  openSessionTask,
  untakenMessagesTask,
  takeMessagesTask,
];

/** The {@link AgentInboxStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteAgentInboxStore(host: StoreHost): AgentInboxStore {
  return {
    add: bindTask(host, addInboxMessageTask),
    get: bindTask(host, getInboxMessageTask),
    openSession: bindTask(host, openSessionTask),
    untaken: bindTask(host, untakenMessagesTask),
    take: bindTask(host, takeMessagesTask),
  };
}
