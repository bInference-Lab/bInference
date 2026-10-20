import { BinferenceError, type JsonValue, type Logger } from "@binference/core";
import type { Api } from "grammy";
import { callBotApi } from "../api/call-bot-api.js";
import type { BotCalls, ButtonRows } from "../ingress/bot-calls.js";
import type { ButtonPress } from "../updates/chat-update.schema.js";

/**
 * A part of the owner's chat that shows pushes of an agent's chat topic as messages with buttons,
 * and takes the presses of those buttons: the agent's questions and its launch drafts.
 */
export interface TopicButtons {
  /** Shows a push of an agent's chat topic it concerns; any other push does nothing. */
  show(
    push: { readonly kind: string; readonly data: JsonValue },
    options: { readonly signal: AbortSignal },
  ): Promise<void>;
  /**
   * Takes a press of one of its buttons and resolves `true` once it is answered; `false` for data
   * in any other form, which it leaves alone. A press the engine does not take for the owner's
   * gets no answer at all.
   */
  press(press: ButtonPress, options: { readonly signal: AbortSignal }): Promise<boolean>;
}

function markupOf(buttons: ButtonRows) {
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((button) => ({
        text: button.text,
        ...("data" in button
          ? { callback_data: button.data }
          : { web_app: { url: button.webApp } }),
      })),
    ),
  };
}

/**
 * Sends a Telegram HTML message with its buttons and no link preview to a chat, as a reply to
 * `replyTo` when given, and answers the message's id.
 */
export async function sendButtonMessage(
  api: Api,
  message: {
    readonly chatId: number;
    readonly html: string;
    readonly buttons: ButtonRows;
    readonly replyTo?: number;
  },
  signal: AbortSignal,
): Promise<number> {
  const { chatId, html, buttons, replyTo } = message;
  const reply =
    replyTo === undefined
      ? {}
      : { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } };
  const sent = await callBotApi("sendMessage", signal, async (stop) =>
    api.sendMessage(
      chatId,
      html,
      {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: markupOf(buttons),
        ...reply,
      },
      stop,
    ),
  );
  return sent.message_id;
}

/**
 * Answers a press with its notice once the engine took it. A failed answer is logged as
 * `telegram.press_answer_failed` and never undoes what the engine did; an abort is thrown.
 */
export async function answerPress(
  bot: Pick<BotCalls, "answer">,
  pressed: { readonly callbackId: string; readonly notice: string | undefined },
  call: { readonly signal: AbortSignal; readonly logger: Logger },
): Promise<void> {
  try {
    await bot.answer(pressed.callbackId, pressed.notice, call);
  } catch (error) {
    call.signal.throwIfAborted();
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    call.logger.warn("telegram.press_answer_failed", { errorCode });
  }
}
