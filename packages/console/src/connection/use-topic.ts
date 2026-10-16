import type { TopicHandlers } from "@binference/client";
import type { PushTopic } from "@binference/protocol";
import { useEffect, useRef } from "react";
import { useEngine } from "./engine-context";

/**
 * Follows a push topic while the component is mounted, through the console's one subscription
 * to it. The handlers may change on each render; the latest ones hear the next push.
 */
export function useTopic(topic: PushTopic | undefined, handlers: TopicHandlers): void {
  const { topics } = useEngine();
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (topic === undefined) {
      return undefined;
    }
    return topics.listen(topic, {
      onPush: (push) => latest.current.onPush(push),
      refetch: async (signal) => latest.current.refetch(signal),
    });
  }, [topic, topics]);
}
