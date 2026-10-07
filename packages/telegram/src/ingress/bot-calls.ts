import type { Api } from "grammy";
import { isMessageGone } from "../api/bot-api-error.schema.js";
import { callBotApi } from "../api/call-bot-api.js";
import type { ReplyTarget } from "./decide-update.js";

/** The Bot API calls the ingress makes, with their faults mapped. */
export interface BotCalls {
  /** Sends a plain-text message, with no link preview. */
  reply(
    target: ReplyTarget,
    text: string,
    options: { readonly signal: AbortSignal },
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
  return {
    reply: async (target, text, options) => {
      await callBotApi("sendMessage", options.signal, async (signal) =>
        api.sendMessage(
          target.chatId,
          text,
          {
            ...(target.threadId === undefined ? {} : { message_thread_id: target.threadId }),
            link_preview_options: { is_disabled: true },
          },
          signal,
        ),
      );
    },
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
