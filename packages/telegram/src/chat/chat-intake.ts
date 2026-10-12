import { BinferenceError, type Clock, type Logger } from "@binference/core";
import type { MessageLocale, MessageValues } from "@binference/i18n";
import type { Api } from "grammy";
import { chooseAgent } from "../commands/agent-commands.js";
import { type CallContext, callOrSay } from "../commands/command-context.js";
import { createOwnerFormatters } from "../format/owner-formatters.js";
import { type BotCalls, createBotCalls } from "../ingress/bot-calls.js";
import type { OwnerCalls } from "../ports.js";
import type { ChatPost } from "../updates/chat-update.schema.js";
import { chatMessageOf } from "./chat-message.js";
import { createPostBatches, type PostBatch } from "./post-batches.js";

/**
 * Takes the owner's chat posts that no fast command answered and hands them to the agent with
 * `chat/post`, a batch at a time.
 */
export interface ChatIntake {
  /**
   * Holds one of the owner's posts for the agent, and resolves once it is held, not once it is
   * posted. An edit, a forward, or a post with neither text nor a photo is answered in the chat
   * at once and goes no further.
   */
  take(post: ChatPost, options: { readonly signal: AbortSignal }): Promise<void>;
  /** Resolves once every batch whose window closed is posted or refused. */
  idle(): Promise<void>;
  /** Drops the batches still open and waits for the posts in flight. */
  close(): Promise<void>;
}

/** What {@link createChatIntake} needs. */
export interface ChatIntakeOptions {
  /** The bot's grammY `Api`, with the token's throttler installed. */
  readonly api: Api;
  /** The engine's side: runs `chat/post` for the owner alone. */
  readonly calls: OwnerCalls;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The owner's language and timezone as they are now, read for each reply. */
  readonly display: () => { readonly locale: MessageLocale; readonly timeZone: string };
}

type Refusal = "telegram.chat.edited" | "telegram.chat.forwarded" | "telegram.chat.unsupported";

// An edit or a forward is not the owner's new message, and a post with nothing the agent reads
// is not one either.
function refusalOf(post: ChatPost): Refusal | undefined {
  if (post.kind === "edit") {
    return "telegram.chat.edited";
  }
  if (post.isForwarded) {
    return "telegram.chat.forwarded";
  }
  const isEmpty = (post.text === undefined || post.text === "") && post.photo === undefined;
  return isEmpty ? "telegram.chat.unsupported" : undefined;
}

/** What the intake works with once it is made. */
interface Parts {
  readonly options: ChatIntakeOptions;
  readonly bot: BotCalls;
  readonly words: (key: string, values?: MessageValues) => string;
  readonly stop: AbortSignal;
}

function contextOf(parts: Parts, batch: PostBatch): CallContext {
  const { bot, words, stop: signal } = parts;
  return {
    calls: parts.options.calls,
    senderId: batch.senderId,
    signal,
    say: async (text) => bot.say({ chatId: batch.chatId }, text, { signal }),
    words,
  };
}

// The notes on photos left out go first, then the message, to the only agent.
async function postBatch(parts: Parts, batch: PostBatch): Promise<void> {
  const message = chatMessageOf(batch.posts);
  const context = contextOf(parts, batch);
  if (message.tooLarge > 0) {
    await context.say(parts.words("telegram.chat.photoTooLarge", { count: message.tooLarge }));
  }
  if (message.leftOut > 0) {
    await context.say(parts.words("telegram.chat.photosLeftOut", { count: message.leftOut }));
  }
  if (message.text === "" && message.images.length === 0) {
    return;
  }
  const agent = await chooseAgent(context);
  if (agent === undefined) {
    return;
  }
  const images = message.images.length === 0 ? {} : { images: message.images };
  await callOrSay(context, "chat/post", { agent: agent.id, text: message.text, ...images });
}

/** The batches posted one at a time, in the order their windows closed. */
interface PostLine {
  add(batch: PostBatch): void;
  /** Resolves once every batch added so far is posted or refused. */
  idle(): Promise<void>;
}

// A failed post is logged by its code; the next batch goes on.
function createPostLine(parts: Parts): PostLine {
  let line: Promise<void> = Promise.resolve();
  const send = async (batch: PostBatch): Promise<void> => {
    try {
      await postBatch(parts, batch);
    } catch (error) {
      if (!parts.stop.aborted) {
        const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
        parts.options.logger.warn("telegram.chat_post_failed", { errorCode });
      }
    }
  };
  return {
    add(batch) {
      line = line.then(async () => send(batch));
    },
    async idle() {
      for (let seen = line; ; seen = line) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- a batch may join behind the one awaited
        await seen;
        if (seen === line) {
          return;
        }
      }
    },
  };
}

function wordsOf(options: ChatIntakeOptions) {
  const formatters = createOwnerFormatters();
  return (key: string, values?: MessageValues): string =>
    // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
    formatters(options.display()).message(key, values);
}

/**
 * Creates the owner's chat intake (ARCHITECTURE.md section 12). Posts of one chat that come within
 * 300 ms of each other, a paste Telegram split or an album, become one `chat/post` for the only
 * agent, at most 12 posts, 50,000 characters or 3 seconds of them. Its photos go as `tg:<file id>`,
 * at most 4 and each at most 5 MiB; the owner is told how many were left out. Batches are posted
 * one at a time, in the order their windows closed; a refusal is said in the chat as its error
 * message.
 */
export function createChatIntake(options: ChatIntakeOptions): ChatIntake {
  const stopping = new AbortController();
  const parts: Parts = {
    options,
    bot: createBotCalls(options.api),
    words: wordsOf(options),
    stop: stopping.signal,
  };
  const line = createPostLine(parts);
  const batches = createPostBatches({
    clock: options.clock,
    stop: stopping.signal,
    onBatch: (batch) => line.add(batch),
  });
  return {
    async take(given, { signal }) {
      const refusal = refusalOf(given);
      if (refusal !== undefined) {
        await parts.bot.reply({ chatId: given.chatId }, parts.words(refusal), { signal });
        return;
      }
      if (given.sender !== undefined) {
        batches.add(given, given.sender.id);
      }
    },
    idle: async () => line.idle(),
    async close() {
      stopping.abort();
      batches.clear();
      await line.idle();
    },
  };
}
