import type { AgentTopic, AgentTopicKey } from "../surfaces/agent-topic.js";
import type { AgentTopicStore } from "../surfaces/ports.js";

function keyOf(key: AgentTopicKey): string {
  return `${key.agentId}:${String(key.chatId)}`;
}

/** Creates an in-memory {@link AgentTopicStore} with no topic, for tests. */
export function createMemoryAgentTopicStore(): AgentTopicStore {
  const topics = new Map<string, AgentTopic>();
  return {
    find: async (key, options) => {
      options.signal.throwIfAborted();
      const topic = topics.get(keyOf(key));
      return Promise.resolve(topic === undefined ? undefined : { ...topic });
    },
    keep: async (topic, options) => {
      options.signal.throwIfAborted();
      topics.set(keyOf(topic), { ...topic });
      return Promise.resolve();
    },
    forget: async (gone, options) => {
      options.signal.throwIfAborted();
      if (topics.get(keyOf(gone))?.threadId === gone.threadId) {
        topics.delete(keyOf(gone));
      }
      return Promise.resolve();
    },
  };
}
