import type { AgentInboxStore } from "@binference/engine/chat";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import {
  addInboxMessageTask,
  openSessionTask,
  takeMessagesTask,
  untakenMessagesTask,
} from "./agent-inbox-tasks.js";

/** The {@link AgentInboxStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteAgentInboxStore(host: StoreHost): AgentInboxStore {
  return {
    add: bindTask(host, addInboxMessageTask),
    openSession: bindTask(host, openSessionTask),
    untaken: bindTask(host, untakenMessagesTask),
    take: bindTask(host, takeMessagesTask),
  };
}
