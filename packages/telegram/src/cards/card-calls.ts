import type { Api } from "grammy";
import { isMessageGone } from "../api/bot-api-error.schema.js";
import { callBotApi } from "../api/call-bot-api.js";

/** Where a card message sits in Telegram. */
export interface MessageAt {
  readonly chatId: number;
  readonly messageId: number;
}

/** A card message to send: its HTML and its buttons, in one row. */
interface CardMessage {
  readonly chatId: number;
  /** The agent's topic in the owner's chat. */
  readonly threadId?: number;
  readonly html: string;
  readonly buttons: readonly { readonly text: string; readonly data: string }[];
}

interface Call {
  readonly signal: AbortSignal;
}

/** The Bot API calls cards make, with their faults mapped. */
export interface CardCalls {
  /** Sends a card in HTML with its buttons, with no link preview; answers its message id. */
  send(card: CardMessage, call: Call): Promise<number>;
  /**
   * Edits a card message into its receipt and removes its buttons. A message Telegram no longer
   * has, or one that shows the receipt already, counts as done.
   */
  receipt(at: MessageAt, html: string, call: Call): Promise<void>;
  /** Removes a message's buttons; one Telegram no longer has, or one without them, counts as done. */
  dropButtons(at: MessageAt, call: Call): Promise<void>;
  /** Answers a button press: with a short notice, or silently to stop the button's spinner. */
  answer(callbackId: string, notice: string | undefined, call: Call): Promise<void>;
}

async function unlessGone<T>(edit: Promise<T>): Promise<void> {
  try {
    await edit;
  } catch (error) {
    if (!isMessageGone(error)) {
      throw error;
    }
  }
}

/** Binds the cards' Bot API calls to a grammY `Api` for the bot. */
export function createCardCalls(api: Api): CardCalls {
  return {
    send: async (card, call) => {
      const sent = await callBotApi("sendMessage", call.signal, async (signal) =>
        api.sendMessage(
          card.chatId,
          card.html,
          {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            reply_markup: {
              inline_keyboard: [
                card.buttons.map((button) => ({ text: button.text, callback_data: button.data })),
              ],
            },
            ...(card.threadId === undefined ? {} : { message_thread_id: card.threadId }),
          },
          signal,
        ),
      );
      return sent.message_id;
    },
    receipt: async (at, html, call) =>
      unlessGone(
        callBotApi("editMessageText", call.signal, async (signal) =>
          api.editMessageText(at.chatId, at.messageId, html, { parse_mode: "HTML" }, signal),
        ),
      ),
    dropButtons: async (at, call) =>
      unlessGone(
        callBotApi("editMessageReplyMarkup", call.signal, async (signal) =>
          api.editMessageReplyMarkup(at.chatId, at.messageId, {}, signal),
        ),
      ),
    answer: async (callbackId, notice, call) => {
      await callBotApi("answerCallbackQuery", call.signal, async (signal) =>
        api.answerCallbackQuery(callbackId, notice === undefined ? {} : { text: notice }, signal),
      );
    },
  };
}
