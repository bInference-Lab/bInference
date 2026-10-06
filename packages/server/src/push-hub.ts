import {
  BinferenceError,
  type Clock,
  err,
  type JsonValue,
  ok,
  type Result,
} from "@binference/core";
import {
  type ArgsOf,
  type PushFrame,
  pushFrameSchema,
  type PushTopic,
  pushTopicSchema,
  type ResultOf,
  type Scope,
} from "@binference/protocol";
import { topicScope } from "./topic-scope.js";

/** One event to push: its topic, its kind, such as `intent/changed`, and its data as JSON. */
export interface PushEvent {
  readonly topic: PushTopic;
  readonly kind: string;
  readonly data: JsonValue;
}

/** A connection that receives pushes of the topics its scopes allow. */
export interface PushSubscriber {
  readonly id: string;
  readonly scopes: readonly Scope[];
  readonly send: (push: PushFrame) => void;
}

/** A subscription's answer, and the pushes the subscriber missed since its `fromSeq`. */
interface Subscription {
  readonly view: ResultOf<"push/subscribe">;
  /** Send these after the reply, in order. */
  readonly replay: readonly PushFrame[];
}

/** Keeps each topic's `seq` and recent pushes, and sends each push to its subscribers. */
export interface PushHub {
  /**
   * Gives the event the topic's next `seq`, keeps it, and sends it to every subscriber of the
   * topic. Throws `server.bad_push` for an event the push schema refuses, and
   * `server.too_many_topics` for a new topic past `maxTopics`.
   */
  publish(event: PushEvent): PushFrame;
  /**
   * Subscribes to topics. A topic with `fromSeq` replays what the subscriber missed; one whose
   * `fromSeq` is older than the kept pushes, or past the current `seq` (the server restarted), is
   * listed in `resync`. Returns `scope` for a topic the subscriber's scopes do not allow, and
   * `busy` past `maxTopicsPerConnection`; either subscribes to nothing.
   */
  subscribe(
    subscriber: PushSubscriber,
    topics: ArgsOf<"push/subscribe">["topics"],
  ): Result<Subscription, "scope" | "busy">;
  unsubscribe(subscriberId: string, topics: readonly PushTopic[]): void;
  /** Ends every subscription of a subscriber, as when its connection closes. */
  drop(subscriberId: string): void;
}

/** What a {@link PushHub} keeps, and for how long. */
export interface PushHubOptions {
  readonly clock: Clock;
  readonly maxPushesPerTopic: number;
  readonly pushRetentionMs: number;
  readonly maxTopics: number;
  readonly maxTopicsPerConnection: number;
}

interface Kept {
  readonly push: PushFrame;
  readonly atMs: number;
}

interface TopicLog {
  readonly seq: number;
  /** The kept pushes, oldest first; trimmed on every publish and subscribe. */
  readonly kept: Kept[];
}

interface Subscribed {
  readonly subscriber: PushSubscriber;
  readonly topics: Set<PushTopic>;
}

type TopicStart = NonNullable<ArgsOf<"push/subscribe">["topics"][PushTopic]>;

function startsOf(topics: ArgsOf<"push/subscribe">["topics"]): readonly [PushTopic, TopicStart][] {
  return Object.entries(topics).flatMap(([text, start]): [PushTopic, TopicStart][] => {
    const topic = pushTopicSchema.safeParse(text);
    return topic.success && start !== undefined ? [[topic.data, start]] : [];
  });
}

function trim(log: TopicLog, options: PushHubOptions): void {
  const oldestAt = options.clock.now() - options.pushRetentionMs;
  const over = log.kept.length - options.maxPushesPerTopic;
  const stale = log.kept.findIndex((kept) => kept.atMs >= oldestAt);
  log.kept.splice(0, Math.max(over, stale === -1 ? log.kept.length : stale, 0));
}

// The missed pushes, or `undefined` when the kept ones no longer reach back to `fromSeq`.
function missed(log: TopicLog, fromSeq: number): readonly PushFrame[] | undefined {
  if (fromSeq > log.seq + 1) {
    return undefined;
  }
  const oldest = log.kept[0]?.push.seq ?? log.seq + 1;
  return fromSeq < oldest
    ? undefined
    : log.kept.flatMap((kept) => (kept.push.seq >= fromSeq ? [kept.push] : []));
}

function badPush(event: PushEvent): BinferenceError {
  return new BinferenceError({
    code: "server.bad_push",
    message: "A push breaks the push frame schema.",
    details: { topic: event.topic, kind: event.kind },
  });
}

interface Hub {
  readonly options: PushHubOptions;
  readonly logs: Map<PushTopic, TopicLog>;
  readonly subscribed: Map<string, Subscribed>;
}

function logOf(hub: Hub, topic: PushTopic): TopicLog {
  const log = hub.logs.get(topic) ?? { seq: 0, kept: [] };
  trim(log, hub.options);
  return log;
}

function append(hub: Hub, event: PushEvent): PushFrame {
  const { options, logs } = hub;
  if (!logs.has(event.topic) && logs.size >= options.maxTopics) {
    throw new BinferenceError({
      code: "server.too_many_topics",
      message: `The server keeps at most ${String(options.maxTopics)} push topics.`,
      details: { maxTopics: options.maxTopics },
    });
  }
  const log = logOf(hub, event.topic);
  const parsed = pushFrameSchema.safeParse({ t: "push", seq: log.seq + 1, ...event });
  if (!parsed.success) {
    throw badPush(event);
  }
  log.kept.push({ push: parsed.data, atMs: options.clock.now() });
  logs.set(event.topic, { seq: parsed.data.seq, kept: log.kept });
  trim(log, options);
  return parsed.data;
}

function subscription(hub: Hub, starts: readonly [PushTopic, TopicStart][]): Subscription {
  const seqs = starts.map(([topic]): [PushTopic, number] => [topic, logOf(hub, topic).seq]);
  const replays = starts.map(([topic, start]) =>
    start.fromSeq === undefined ? [] : missed(logOf(hub, topic), start.fromSeq),
  );
  const resync = starts.flatMap(([topic], index) => (replays[index] === undefined ? [topic] : []));
  const view = { seqs: Object.fromEntries(seqs), ...(resync.length === 0 ? {} : { resync }) };
  return { view, replay: replays.flatMap((pushes) => pushes ?? []) };
}

function subscribe(
  hub: Hub,
  subscriber: PushSubscriber,
  topics: ArgsOf<"push/subscribe">["topics"],
): Result<Subscription, "scope" | "busy"> {
  const starts = startsOf(topics);
  if (starts.some(([topic]) => !subscriber.scopes.includes(topicScope(topic)))) {
    return err("scope");
  }
  const current = hub.subscribed.get(subscriber.id)?.topics ?? new Set<PushTopic>();
  const next = new Set([...current, ...starts.map(([topic]) => topic)]);
  if (next.size > hub.options.maxTopicsPerConnection) {
    return err("busy");
  }
  hub.subscribed.set(subscriber.id, { subscriber, topics: next });
  return ok(subscription(hub, starts));
}

/** Creates an empty {@link PushHub}. Each topic's `seq` starts at 1 and rises by 1. */
export function createPushHub(options: PushHubOptions): PushHub {
  const hub: Hub = { options, logs: new Map(), subscribed: new Map() };
  return {
    publish(event) {
      const push = append(hub, event);
      hub.subscribed.forEach(({ subscriber, topics }) => {
        if (topics.has(push.topic)) {
          subscriber.send(push);
        }
      });
      return push;
    },
    subscribe: (subscriber, topics) => subscribe(hub, subscriber, topics),
    unsubscribe(subscriberId, topics) {
      const entry = hub.subscribed.get(subscriberId);
      topics.forEach((topic) => entry?.topics.delete(topic));
    },
    drop(subscriberId) {
      hub.subscribed.delete(subscriberId);
    },
  };
}
