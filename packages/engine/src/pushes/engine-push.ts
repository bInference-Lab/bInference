import type { JsonValue } from "@binference/core";
import type { PushTopic } from "@binference/protocol";

/**
 * One push the engine sends to the clients subscribed to its topic: the topic, the kind, such as
 * `intent/changed`, and its data as JSON. The protocol server numbers each topic's pushes with
 * their `seq`.
 */
export interface EnginePush {
  readonly topic: PushTopic;
  readonly kind: string;
  readonly data: JsonValue;
}

/**
 * Hands one push to the protocol server, which sends it at once and never throws: a push is
 * telemetry for the money path, so a failing one never blocks it.
 */
export type PublishPush = (push: EnginePush) => void;
