import type { ChatQueueStore } from "../ports.js";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { addQueuedTask, dropQueuedTask, takeQueuedTask, waitingTask } from "./queue-tasks.js";

/** The {@link ChatQueueStore} on `agent.sqlite`: each call runs one store task. */
export function createSqliteChatQueueStore(host: StoreHost): ChatQueueStore {
  return {
    add: bindTask(host, addQueuedTask),
    waiting: bindTask(host, waitingTask),
    take: bindTask(host, takeQueuedTask),
    drop: bindTask(host, dropQueuedTask),
  };
}
