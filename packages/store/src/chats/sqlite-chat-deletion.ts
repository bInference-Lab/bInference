import type { ChatDeletion } from "../ports.js";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { deleteChatsTask } from "./deletion-tasks.js";

/** The {@link ChatDeletion} of `agent.sqlite`. */
export function createSqliteChatDeletion(host: StoreHost): ChatDeletion {
  return { delete: bindTask(host, deleteChatsTask) };
}
