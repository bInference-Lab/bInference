import type { Logger } from "@binference/core";
import type { ArgsOf, PushFrame, PushTopic, ResultOf } from "@binference/protocol";
import { clientError } from "./client-error.js";
import { logFailure } from "./log-failure.js";

type SubscribeArgs = ArgsOf<"push/subscribe">;
type TopicStart = NonNullable<SubscribeArgs["topics"][PushTopic]>;

/** What a subscriber gives for one topic. */
export interface TopicHandlers {
  /** Receives each push of the topic in `seq` order, once the topic's state is loaded. */
  readonly onPush: (push: PushFrame) => void;
  /**
   * Loads the topic's state with its list operation: when the subscription starts, after a gap in
   * `seq`, and when the engine no longer holds the pushes the client missed. Pushes that arrive
   * during a load are covered by it and never reach `onPush`.
   */
  readonly refetch: (signal: AbortSignal) => Promise<void>;
}

/** How the subscriptions reach the engine. */
export interface PushSubscriptionsOptions {
  /** The most topics subscribed at once. */
  readonly maxTopics: number;
  readonly logger: Logger;
  /** Whether a connection is ready; while it is not, the next `resume` subscribes. */
  readonly isConnected: () => boolean;
  /** Calls `push/subscribe`. */
  readonly subscribe: (args: SubscribeArgs) => Promise<ResultOf<"push/subscribe">>;
  /** Calls `push/unsubscribe` for a topic. */
  readonly unsubscribe: (topic: PushTopic) => Promise<void>;
}

/** The client's push topics, each with its subscriber and the last `seq` it saw. */
export interface PushSubscriptions {
  /**
   * Subscribes to a topic and returns the call that ends the subscription. Throws `client.busy`
   * when the topic already has a subscriber or the client holds `maxTopics` topics.
   */
  add(topic: PushTopic, handlers: TopicHandlers): () => void;
  /** Takes one push: delivers it, skips a repeat, or refetches once after a gap. */
  receive(push: PushFrame): void;
  /** Subscribes every topic again on a new connection, each from the push after its last. */
  resume(): void;
  /** Ends every subscription and stops their loads. */
  clear(): void;
}

// new: subscribed, state not loaded yet; refetching: a load runs; live: pushes reach onPush.
type Phase = "new" | "refetching" | "live";

interface TopicState {
  readonly phase: Phase;
  readonly lastSeq?: number;
  readonly handlers: TopicHandlers;
  readonly loads: AbortController;
}

interface Topics {
  readonly states: Map<PushTopic, TopicState>;
  readonly options: PushSubscriptionsOptions;
}

function startOf(state: TopicState): TopicStart {
  return state.phase === "new" || state.lastSeq === undefined ? {} : { fromSeq: state.lastSeq + 1 };
}

// After a load for a gap or a resync, the topic subscribes again from the push after its last,
// as the protocol asks. The first load needs no second subscribe.
async function refetch(topics: Topics, topic: PushTopic, state: TopicState): Promise<void> {
  await logFailure(topics.options.logger, "client.refetch_failed", async () =>
    state.handlers.refetch(state.loads.signal),
  );
  const latest = topics.states.get(topic);
  if (state.loads.signal.aborted || latest === undefined) {
    return;
  }
  topics.states.set(topic, { ...latest, phase: "live" });
  if (state.phase !== "new") {
    await request(topics, [topic]);
  }
}

function startRefetch(topics: Topics, topic: PushTopic): void {
  const state = topics.states.get(topic);
  if (state === undefined || state.phase === "refetching") {
    return;
  }
  topics.states.set(topic, { ...state, phase: "refetching" });
  void refetch(topics, topic, state);
}

function settle(topics: Topics, topic: PushTopic, reply: ResultOf<"push/subscribe">): void {
  const state = topics.states.get(topic);
  const currentSeq = reply.seqs[topic];
  if (state === undefined || currentSeq === undefined || state.phase === "refetching") {
    return;
  }
  const lastSeq = state.lastSeq ?? currentSeq;
  if (state.phase === "new") {
    topics.states.set(topic, { ...state, lastSeq: Math.max(lastSeq, currentSeq) });
    startRefetch(topics, topic);
    return;
  }
  // A seq below the last one seen means the engine started over, as after a restart.
  if (reply.resync?.includes(topic) === true || currentSeq < lastSeq) {
    topics.states.set(topic, { ...state, lastSeq: currentSeq });
    startRefetch(topics, topic);
  }
}

async function request(topics: Topics, list: readonly PushTopic[]): Promise<void> {
  const starts = list.flatMap((topic): [PushTopic, TopicStart][] => {
    const state = topics.states.get(topic);
    return state === undefined ? [] : [[topic, startOf(state)]];
  });
  if (starts.length === 0 || !topics.options.isConnected()) {
    return;
  }
  await logFailure(topics.options.logger, "client.subscribe_failed", async () => {
    const reply = await topics.options.subscribe({ topics: Object.fromEntries(starts) });
    starts.forEach(([topic]) => settle(topics, topic, reply));
  });
}

function receive(topics: Topics, push: PushFrame): void {
  const state = topics.states.get(push.topic);
  const lastSeq = state?.lastSeq ?? 0;
  if (state === undefined || push.seq <= lastSeq) {
    return;
  }
  topics.states.set(push.topic, { ...state, lastSeq: push.seq });
  if (state.phase !== "live") {
    return;
  }
  if (push.seq > lastSeq + 1) {
    startRefetch(topics, push.topic);
    return;
  }
  void logFailure(topics.options.logger, "client.push_failed", async () =>
    state.handlers.onPush(push),
  );
}

function add(topics: Topics, topic: PushTopic, handlers: TopicHandlers): () => void {
  const { states, options } = topics;
  if (states.has(topic) || states.size >= options.maxTopics) {
    throw clientError({
      code: "client.busy",
      message: `Topic ${topic} has a subscriber, or ${String(options.maxTopics)} topics are taken.`,
    });
  }
  states.set(topic, { phase: "new", handlers, loads: new AbortController() });
  void request(topics, [topic]);
  return () => {
    if (states.get(topic)?.handlers !== handlers) {
      return;
    }
    states.get(topic)?.loads.abort();
    states.delete(topic);
    if (options.isConnected()) {
      void logFailure(topics.options.logger, "client.unsubscribe_failed", async () =>
        options.unsubscribe(topic),
      );
    }
  };
}

/** Creates the push subscriptions of one client. */
export function createPushSubscriptions(options: PushSubscriptionsOptions): PushSubscriptions {
  const topics: Topics = { states: new Map(), options };
  return {
    add: (topic, handlers) => add(topics, topic, handlers),
    receive: (push) => receive(topics, push),
    resume: () => void request(topics, [...topics.states.keys()]),
    clear() {
      topics.states.forEach((state) => state.loads.abort());
      topics.states.clear();
    },
  };
}
