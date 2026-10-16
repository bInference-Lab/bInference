import type { ProtocolClient, TopicHandlers } from "@binference/client";
import type { PushTopic } from "@binference/protocol";

/** Lets several screens follow one push topic over the client's single subscription to it. */
export interface TopicFanout {
  /**
   * Hears a topic's pushes and refetches until the returned call stops it. The first listener of
   * a topic subscribes the client; the last one to stop unsubscribes it.
   */
  listen(topic: PushTopic, handlers: TopicHandlers): () => void;
}

interface Followed {
  readonly listeners: Set<TopicHandlers>;
  readonly unsubscribe: () => void;
}

/**
 * Creates the fan-out over a client, which holds one subscriber per topic: each push reaches
 * every listener in the order they started, and a refetch runs every listener's refetch.
 */
export function createTopicFanout(client: Pick<ProtocolClient, "subscribe">): TopicFanout {
  const topics = new Map<PushTopic, Followed>();
  const follow = (topic: PushTopic): Followed => {
    const listeners = new Set<TopicHandlers>();
    const unsubscribe = client.subscribe(topic, {
      onPush: (push) => {
        listeners.forEach((listener) => listener.onPush(push));
      },
      refetch: async (signal) => {
        await Promise.all([...listeners].map(async (listener) => listener.refetch(signal)));
      },
    });
    return { listeners, unsubscribe };
  };
  return {
    listen(topic, handlers) {
      const followed = topics.get(topic) ?? follow(topic);
      topics.set(topic, followed);
      followed.listeners.add(handlers);
      return () => {
        followed.listeners.delete(handlers);
        if (followed.listeners.size === 0 && topics.get(topic) === followed) {
          topics.delete(topic);
          followed.unsubscribe();
        }
      };
    },
  };
}
