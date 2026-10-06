import { BinferenceError } from "@binference/core";
import type { Api } from "grammy";
import { assertGrammySignal } from "../api/assert-grammy-signal.js";
import { botApiFault } from "../api/bot-api-error.schema.js";
import type { ReplyTarget } from "./decide-update.js";

/** The longest one Bot API call from the ingress may take. */
const callTimeoutMs = 30_000;
// Telegram answers 400 for a message it no longer has or may not delete (older than 48 hours).
const goneStatus = 400;

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

async function bounded<T>(
  method: string,
  signal: AbortSignal,
  run: (callSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  try {
    return await run(AbortSignal.any([signal, AbortSignal.timeout(callTimeoutMs)]));
  } catch (error) {
    signal.throwIfAborted();
    throw botApiFault(error, method);
  }
}

/** Binds the ingress's Bot API calls to a grammY `Api` for the bot. */
export function createBotCalls(api: Api): BotCalls {
  return {
    reply: async (target, text, options) => {
      await bounded("sendMessage", options.signal, async (signal) =>
        api.sendMessage(
          target.chatId,
          text,
          {
            ...(target.threadId === undefined ? {} : { message_thread_id: target.threadId }),
            link_preview_options: { is_disabled: true },
          },
          assertGrammySignal(signal),
        ),
      );
    },
    deleteMessage: async (chatId, messageId, options) => {
      try {
        await bounded("deleteMessage", options.signal, async (signal) =>
          api.deleteMessage(chatId, messageId, assertGrammySignal(signal)),
        );
      } catch (error) {
        const isGone =
          error instanceof BinferenceError &&
          error.code === "telegram.api_refused" &&
          error.details["status"] === goneStatus;
        if (!isGone) {
          throw error;
        }
      }
    },
  };
}
