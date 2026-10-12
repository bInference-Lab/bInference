import { BinferenceError, type Clock, type Id, type Logger } from "@binference/core";
import type { AgentStore } from "@binference/engine";
import type { AgentTopicStore, Notice } from "@binference/engine/surfaces";
import type { Api } from "grammy";
import { callBotApi } from "../api/call-bot-api.js";
import { backoffAfter, deliveryFateOf } from "./delivery-fate.js";

/**
 * Where a notice goes in the owner's chat (decision 0186): the agent's topic, or the chat itself
 * with the agent's name before the notice when its words do not name it; or nothing yet, until
 * `atMs`, while Telegram cannot say whether topics work or make the agent's topic.
 */
export type NoticePlace =
  | { readonly kind: "chat"; readonly agentName?: string }
  | { readonly kind: "topic"; readonly threadId: number }
  | { readonly kind: "wait"; readonly atMs: number };

/** One agent's topic Telegram said is gone. */
interface GoneTopic {
  readonly notice: Notice;
  readonly chatId: number;
  readonly threadId: number;
}

/** Where the owner's notices go in the chat, one agent's topic at a time. */
export interface NoticePlaces {
  /** Where a notice goes in the owner's chat now. */
  placeOf(
    notice: Notice,
    chatId: number,
    call: { readonly signal: AbortSignal },
  ): Promise<NoticePlace>;
  /** Forgets an agent's topic Telegram said is gone, so the next notice makes a new one. */
  gone(topic: GoneTopic, call: { readonly signal: AbortSignal }): Promise<void>;
}

/** The topics of the owner's chat: whether they are on, and where each agent's is kept. */
export interface NoticeTopics {
  /** config.json5's `telegram.topicsPerAgent` as it is now. */
  readonly isOn: () => boolean;
  readonly store: AgentTopicStore;
}

/** What {@link createNoticePlaces} needs. */
export interface NoticePlacesOptions {
  /** The bot's grammY `Api`, with the token's throttler installed. */
  readonly api: Api;
  /** The agents, whose names title their topics and stand before their notices. */
  readonly agents: Pick<AgentStore, "get">;
  /** The topics; left out, every notice goes to the chat itself. */
  readonly topics?: NoticeTopics;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** What the places remember between notices. */
interface PlacesMemory {
  /** Whether `getMe` said the bot has topics in private chats, once it answered. */
  readonly hasTopics: () => boolean | undefined;
  readonly learnTopics: (bot: { readonly hasTopics: boolean }) => void;
  /** Counts one more call for topics that failed in a row, and answers the count. */
  readonly failed: () => number;
  readonly succeeded: () => void;
}

interface Places {
  readonly options: NoticePlacesOptions;
  readonly memory: PlacesMemory;
}

function createPlacesMemory(): PlacesMemory {
  let hasTopics: boolean | undefined;
  let failures = 0;
  return {
    hasTopics: () => hasTopics,
    learnTopics: (bot) => {
      ({ hasTopics } = bot);
    },
    failed: () => {
      failures += 1;
      return failures;
    },
    succeeded: () => {
      failures = 0;
    },
  };
}

interface Named {
  readonly agentId: Id<"agt">;
  readonly notice: Notice;
  readonly chatId: number;
  readonly name: string;
  readonly signal: AbortSignal;
}

// The chat itself, with the agent's name before a notice whose words do not name the agent.
function inChat(named: Pick<Named, "notice" | "name">): NoticePlace {
  return named.notice.values["agent"] === undefined
    ? { kind: "chat", agentName: named.name }
    : { kind: "chat" };
}

// A call for topics failed: a refusal or an unknown outcome waits out its backoff, and anything
// Telegram refuses for good is undefined, so the notice goes to the chat itself.
function waitAfter(places: Places, fault: BinferenceError | undefined): NoticePlace | undefined {
  const failures = places.memory.failed();
  const fate = deliveryFateOf(fault, failures);
  const now = places.options.clock.now();
  if (fate.kind === "retry") {
    return { kind: "wait", atMs: now + fate.afterMs };
  }
  return fate.kind === "unknown" ? { kind: "wait", atMs: now + backoffAfter(failures) } : undefined;
}

// Whether the bot has topics in private chats, asked once with `getMe` (decision 0186).
async function botHasTopics(places: Places, signal: AbortSignal): Promise<boolean> {
  const known = places.memory.hasTopics();
  if (known !== undefined) {
    return known;
  }
  const { api, logger } = places.options;
  const me = await callBotApi("getMe", signal, async (inner) => api.getMe(inner));
  places.memory.learnTopics({ hasTopics: me.has_topics_enabled });
  if (!me.has_topics_enabled) {
    logger.warn("telegram.topics_off", {});
  }
  return me.has_topics_enabled;
}

// The agent's topic in the chat: the one kept, or a new one titled with the agent's name.
async function topicOf(places: Places, topics: NoticeTopics, named: Named): Promise<number> {
  const { agentId, chatId, name, signal } = named;
  const kept = await topics.store.find({ agentId, chatId }, { signal });
  if (kept !== undefined) {
    return kept.threadId;
  }
  const { api, clock } = places.options;
  const made = await callBotApi("createForumTopic", signal, async (inner) =>
    api.createForumTopic(chatId, name, {}, inner),
  );
  const topic = { agentId, chatId, threadId: made.message_thread_id, createdAtMs: clock.now() };
  await topics.store.keep(topic, { signal });
  return topic.threadId;
}

async function topicPlace(places: Places, topics: NoticeTopics, named: Named) {
  try {
    if (!(await botHasTopics(places, named.signal))) {
      return inChat(named);
    }
    const threadId = await topicOf(places, topics, named);
    places.memory.succeeded();
    return { kind: "topic", threadId } as const;
  } catch (error) {
    named.signal.throwIfAborted();
    const fault = error instanceof BinferenceError ? error : undefined;
    const errorCode = fault?.code ?? "unexpected";
    places.options.logger.warn("telegram.topic_failed", { agentId: named.agentId, errorCode });
    return waitAfter(places, fault) ?? inChat(named);
  }
}

/**
 * Creates where the owner's notices go (decision 0186). A notice that names no agent goes to the
 * chat itself. With topics on, and once `getMe` says the bot has topics in private chats, a notice
 * about an agent goes to the agent's topic, made the first time with the agent's name and kept in
 * the store; a topic Telegram refuses to make for good leaves the notice in the chat, never lost.
 * Otherwise the agent's name stands before a notice whose words do not name it.
 */
export function createNoticePlaces(options: NoticePlacesOptions): NoticePlaces {
  const places: Places = { options, memory: createPlacesMemory() };
  return {
    async placeOf(notice, chatId, call) {
      if (notice.agent === undefined) {
        return { kind: "chat" };
      }
      const found = await options.agents.get(notice.agent, call);
      if (found === undefined) {
        return { kind: "chat" };
      }
      const { name } = found.agent;
      const named = { agentId: notice.agent, notice, chatId, name, signal: call.signal };
      const { topics } = options;
      return topics?.isOn() === true ? topicPlace(places, topics, named) : inChat(named);
    },
    async gone(topic, call) {
      const agentId = topic.notice.agent;
      if (agentId !== undefined && options.topics !== undefined) {
        const { chatId, threadId } = topic;
        await options.topics.store.forget({ agentId, chatId, threadId }, call);
      }
    },
  };
}
