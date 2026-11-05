import type { Clock, Logger } from "@binference/core";
import type { Api } from "grammy";
import { isEntitiesUnparsed } from "../api/bot-api-error.schema.js";
import { callBotApi } from "../api/call-bot-api.js";
import type { ChatHtml } from "./chat-html.js";
import { resendUnsent } from "./resend-unsent.js";

/** What the answer's messages are sent with. */
export interface AnswerSendParts {
  /** The bot's grammY `Api`, with the token's throttler installed. */
  readonly api: Api;
  readonly clock: Clock;
  readonly logger: Logger;
}

interface Call {
  readonly signal: AbortSignal;
}

// One message, sent again while it provably never left.
async function sendText(
  parts: AnswerSendParts,
  message: { readonly chatId: number; readonly text: string; readonly mode: "html" | "plain" },
  call: Call,
): Promise<{ readonly message_id: number }> {
  const format = message.mode === "html" ? { parse_mode: "HTML" as const } : {};
  const options = { ...format, link_preview_options: { is_disabled: true } };
  return resendUnsent(
    async () =>
      callBotApi("sendMessage", call.signal, async (signal) =>
        parts.api.sendMessage(message.chatId, message.text, options, signal),
      ),
    { clock: parts.clock, signal: call.signal },
  );
}

/**
 * Sends one message of Telegram HTML to a chat, again up to 3 tries while it provably never left
 * (decision 0373); it waits out the chat's pace and any 429, as an answer does.
 */
export async function sendHtml(
  parts: AnswerSendParts,
  message: { readonly chatId: number; readonly html: string },
  call: Call,
): Promise<void> {
  await sendText(parts, { chatId: message.chatId, text: message.html, mode: "html" }, call);
}

/**
 * Sends one message of the agent's text as {@link sendHtml} does; a piece whose HTML Telegram
 * cannot read goes again as plain text, so the owner still gets the answer, and the log names the
 * message, never its words.
 */
export async function sendPiece(
  parts: AnswerSendParts,
  message: { readonly chatId: number; readonly piece: ChatHtml },
  call: Call,
): Promise<void> {
  const { chatId, piece } = message;
  try {
    await sendHtml(parts, { chatId, html: piece.html }, call);
  } catch (error) {
    if (!isEntitiesUnparsed(error)) {
      throw error;
    }
    const sent = await sendText(parts, { chatId, text: piece.plain, mode: "plain" }, call);
    parts.logger.info("telegram.chat_sent_plain", { messageId: sent.message_id });
  }
}
