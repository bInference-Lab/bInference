import type { ChatRetention } from "../ports.js";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { pruneChatsTask } from "./retention-tasks.js";

/** The {@link ChatRetention} of `agent.sqlite`. */
export function createSqliteChatRetention(host: StoreHost): ChatRetention {
  return { prune: bindTask(host, pruneChatsTask) };
}
