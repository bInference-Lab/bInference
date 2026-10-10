import type { Api } from "grammy";
import { isMessageGone } from "../api/bot-api-error.schema.js";
import { callBotApi } from "../api/call-bot-api.js";
import { splitText } from "../split/split-text.js";
import type { ReplyTarget } from "./decide-update.js";

/** The Bot API calls the ingress makes, with their faults mapped. */
export interface BotCalls {
  /**
   * Sends a plain-text message, with no link preview; with `replyTo`, as a reply to that message
   * of the chat, or on its own when Telegram no longer has it.
   */
  reply(
    target: ReplyTarget,
    text: string,
    options: { readonly signal: AbortSignal; readonly replyTo?: number },
  ): Promise<void>;
  /**
   * Sends text as plain-text messages of at most 4,096 characters, split at line breaks, one at a
   * time so they reach the chat in order; each answers `replyTo` as {@link BotCalls.reply} does.
   */
  say(
    target: ReplyTarget,
    text: string,
    options: { readonly signal: AbortSignal; readonly replyTo?: number },
  ): Promise<void>;
  /** Deletes a message; one Telegram no longer has or may not delete counts as deleted. */
  deleteMessage(
    chatId: number,
    messageId: number,
    options: { readonly signal: AbortSignal },
  ): Promise<void>;
}

/** Binds the ingress's Bot API calls to a grammY `Api` for the bot. */
export function createBotCalls(api: Api): BotCalls {
  const reply: BotCalls["reply"] = async (target, text, options) => {
    await callBotApi("sendMessage", options.signal, async (signal) =>
      api.sendMessage(
        target.chatId,
        text,
        {
          ...(target.threadId === undefined ? {} : { message_thread_id: target.threadId }),
          ...(options.replyTo === undefined
            ? {}
            : {
                reply_parameters: {
                  message_id: options.replyTo,
                  allow_sending_without_reply: true,
                },
              }),
          link_preview_options: { is_disabled: true },
        },
        signal,
      ),
    );
  };
  return {
    reply,
    say: async (target, text, options) =>
      splitText(text).reduce(async (previous, piece) => {
        await previous;
        await reply(target, piece, options);
      }, Promise.resolve()),
    deleteMessage: async (chatId, messageId, options) => {
      try {
        await callBotApi("deleteMessage", options.signal, async (signal) =>
          api.deleteMessage(chatId, messageId, signal),
        );
      } catch (error) {
        if (!isMessageGone(error)) {
          throw error;
        }
      }
    },
  };
}
