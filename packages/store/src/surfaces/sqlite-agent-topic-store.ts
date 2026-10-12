import type { AgentTopicStore } from "@binference/engine/surfaces";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import {
  findAgentTopicTask,
  forgetAgentTopicTask,
  keepAgentTopicTask,
} from "./agent-topic-tasks.js";

/** Every task of the SQLite agent topic store. */
export const agentTopicTasks: readonly TaskRunner[] = [
  findAgentTopicTask,
  keepAgentTopicTask,
  forgetAgentTopicTask,
];

/**
 * The {@link AgentTopicStore} on `engine.sqlite`: one row of `telegram_topics` for each agent and
 * chat, so an agent keeps its topic across restarts (decision 0186).
 */
export function createSqliteAgentTopicStore(host: StoreHost): AgentTopicStore {
  const find = bindTask(host, findAgentTopicTask);
  const keep = bindTask(host, keepAgentTopicTask);
  const forget = bindTask(host, forgetAgentTopicTask);
  return {
    find: async (key, options) => (await find(key, options)) ?? undefined,
    keep: async (topic, options) => {
      await keep(topic, options);
    },
    forget: async (gone, options) => {
      await forget(gone, options);
    },
  };
}
