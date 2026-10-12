import { err, type JsonValue, ok, type Result } from "@binference/core";
import { z } from "zod";

/** A topic the bot made in a private chat. */
export interface FakeTopic {
  readonly chatId: number;
  readonly threadId: number;
  readonly name: string;
}

/** The topics of a fake bot's private chats. */
export interface FakeTopics {
  /** `createForumTopic`, answered with the topic or the description of a 400. */
  create(body: string): Result<JsonValue, string>;
  /** Whether a message to this thread finds no topic: one never made, or one deleted. */
  isGone(chatId: number, threadId: number): boolean;
  list(): readonly FakeTopic[];
  delete(chatId: number, threadId: number): void;
}

const topicSchema = z.looseObject({ chat_id: z.int(), name: z.string().min(1).max(128) });
// The first topic's thread id; Telegram numbers threads by the message that opened them.
const firstThreadId = 500;
// One of the topic icon colors the Bot API allows.
const iconColor = 0x6f_b9_f0;

function keyOf(chatId: number, threadId: number): string {
  return `${String(chatId)}:${String(threadId)}`;
}

/**
 * Creates the topics of a fake bot. With `hasTopics`, as BotFather's topic mode sets it, the bot
 * may make topics in private chats, and a message to a thread goes only to a topic it made and
 * the owner kept; without it, Telegram makes none and checks no thread.
 */
export function createFakeTopics(options: { readonly hasTopics: boolean }): FakeTopics {
  const { hasTopics } = options;
  const topics = new Map<string, FakeTopic>();
  let lastThreadId = firstThreadId - 1;
  return {
    create(body) {
      const call = topicSchema.safeParse(JSON.parse(body));
      if (!call.success) {
        return err("Bad Request: wrong parameters");
      }
      if (!hasTopics || call.data.chat_id <= 0) {
        return err("Bad Request: the chat is not a forum");
      }
      lastThreadId += 1;
      const topic = { chatId: call.data.chat_id, threadId: lastThreadId, name: call.data.name };
      topics.set(keyOf(topic.chatId, topic.threadId), topic);
      return ok({ message_thread_id: topic.threadId, name: topic.name, icon_color: iconColor });
    },
    isGone: (chatId, threadId) => hasTopics && !topics.has(keyOf(chatId, threadId)),
    list: () => [...topics.values()],
    delete(chatId, threadId) {
      topics.delete(keyOf(chatId, threadId));
    },
  };
}
