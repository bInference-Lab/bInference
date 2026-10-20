import type { Api } from "grammy";
import { callBotApi } from "../api/call-bot-api.js";
import { unlessGone } from "../api/unless-gone.js";
import { splitText } from "../split/split-text.js";
import type { ReplyTarget } from "./decide-update.js";

/** An inline button: a press carries its callback data, or opens the Mini App at an HTTPS URL. */
type Button =
  | { readonly text: string; readonly data: string }
  | { readonly text: string; readonly webApp: string };

/** Rows of inline buttons. */
export type ButtonRows = readonly (readonly Button[])[];

/** How a plain-text message goes out: the message it answers, and its buttons. */
interface SendOptions {
  readonly signal: AbortSignal;
  /** The message of the chat it replies to; it goes on its own when Telegram no longer has it. */
  readonly replyTo?: number;
  readonly buttons?: ButtonRows;
}

/** Where a message sits in Telegram. */
interface MessageAt {
  readonly chatId: number;
  readonly messageId: number;
}

/** The Bot API calls the ingress and the fast commands make, with their faults mapped. */
export interface BotCalls {
  /** Sends a plain-text message, with no link preview. */
  reply(target: ReplyTarget, text: string, options: SendOptions): Promise<void>;
  /**
   * Sends text as plain-text messages of at most 4,096 characters, split at line breaks, one at a
   * time so they reach the chat in order; each answers `replyTo`, and the last carries the buttons.
   */
  say(target: ReplyTarget, text: string, options: SendOptions): Promise<void>;
  /**
   * Edits a plain-text message and its buttons. A message Telegram no longer has, or one that
   * shows the same already, counts as done.
   */
  edit(at: MessageAt, text: string, options: SendOptions): Promise<void>;
  /**
   * Answers a button press: with a short notice, or silently to stop the button's spinner. A
   * notice over Telegram's 200 characters is cut and ends with `…`, so the press still gets it.
   */
  answer(
    callbackId: string,
    notice: string | undefined,
    options: { readonly signal: AbortSignal },
  ): Promise<void>;
  /** Deletes a message; one Telegram no longer has or may not delete counts as deleted. */
  deleteMessage(
    chatId: number,
    messageId: number,
    options: { readonly signal: AbortSignal },
  ): Promise<void>;
}

/** Binds the ingress's and the fast commands' Bot API calls to a grammY `Api` for the bot. */
function markupOf(buttons: ButtonRows | undefined) {
  const inlineKeyboard = (buttons ?? []).map((row) =>
    row.map((button) =>
      "webApp" in button
        ? { text: button.text, web_app: { url: button.webApp } }
        : { text: button.text, callback_data: button.data },
    ),
  );
  return { reply_markup: { inline_keyboard: inlineKeyboard } };
}

function sendOptionsOf(target: ReplyTarget, options: SendOptions) {
  return {
    ...(target.threadId === undefined ? {} : { message_thread_id: target.threadId }),
    ...(options.replyTo === undefined
      ? {}
      : { reply_parameters: { message_id: options.replyTo, allow_sending_without_reply: true } }),
    ...(options.buttons === undefined ? {} : markupOf(options.buttons)),
    link_preview_options: { is_disabled: true },
  };
}

/** The most characters a press's notice holds (Bot API `answerCallbackQuery`). */
const maxNoticeLength = 200;

// Telegram refuses a longer notice, which would leave the button spinning with no word at all.
function noticeOf(notice: string): string {
  return notice.length <= maxNoticeLength
    ? notice
    : `${splitText(notice, maxNoticeLength - 1)[0] ?? ""}…`;
}

// The pieces of a long text go one at a time, so they reach the chat in order; the last one
// carries the buttons.
function sayWith(reply: BotCalls["reply"]): BotCalls["say"] {
  return async (target, text, options) => {
    const pieces = splitText(text);
    const plain = {
      signal: options.signal,
      ...(options.replyTo === undefined ? {} : { replyTo: options.replyTo }),
    };
    await pieces.reduce(async (previous, piece, at) => {
      await previous;
      await reply(target, piece, at === pieces.length - 1 ? options : plain);
    }, Promise.resolve());
  };
}

export function createBotCalls(api: Api): BotCalls {
  const reply: BotCalls["reply"] = async (target, text, options) => {
    await callBotApi("sendMessage", options.signal, async (signal) =>
      api.sendMessage(target.chatId, text, sendOptionsOf(target, options), signal),
    );
  };
  return {
    reply,
    say: sayWith(reply),
    edit: async (at, text, options) =>
      unlessGone(
        callBotApi("editMessageText", options.signal, async (signal) =>
          api.editMessageText(at.chatId, at.messageId, text, markupOf(options.buttons), signal),
        ),
      ),
    answer: async (callbackId, notice, options) => {
      await callBotApi("answerCallbackQuery", options.signal, async (signal) =>
        api.answerCallbackQuery(
          callbackId,
          notice === undefined ? {} : { text: noticeOf(notice) },
          signal,
        ),
      );
    },
    deleteMessage: async (chatId, messageId, options) =>
      unlessGone(
        callBotApi("deleteMessage", options.signal, async (signal) =>
          api.deleteMessage(chatId, messageId, signal),
        ),
      ),
  };
}
