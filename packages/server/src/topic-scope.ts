import type { PushTopic, Scope } from "@binference/protocol";

const narrowTopics: Readonly<Partial<Record<PushTopic, Scope>>> = { inbox: "agent", log: "admin" };

/**
 * The scope a connection needs to receive a topic (protocol spec, section 6): `inbox` needs
 * `agent`, `log` needs `admin`, and every other topic, each agent's chat included, needs `read`.
 */
export function topicScope(topic: PushTopic): Scope {
  return narrowTopics[topic] ?? "read";
}
