import { BinferenceError, type Clock, type Logger } from "@binference/core";
import type { Api } from "grammy";
import {
  isEntitiesUnparsed,
  isMessageGone,
  isNotModified,
  isUnsentRequest,
} from "../api/bot-api-error.schema.js";
import { callBotApi } from "../api/call-bot-api.js";
import { previewSignal } from "../throttle/preview-signal.js";
import type { ChatHtml } from "./chat-html.js";
import { type StatusView, statusPreviewOf, type WorkLine } from "./status-preview.js";

/** What a status message is sent, timed and logged with. */
export interface PreviewParts {
  /** The bot's grammY `Api`, with the token's throttler installed. */
  readonly api: Api;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The headline for a turn that has worked this many seconds, in the owner's language. */
  readonly headline: (seconds: number) => string;
}

/** Where one status message stands. */
export interface Showing {
  readonly messageId?: number;
  /** When Telegram first showed it. */
  readonly visibleAtMs?: number;
  readonly draft?: string;
  readonly lines: readonly WorkLine[];
  /** The HTML the message shows now. */
  readonly shownHtml?: string;
  /** Failures in a row that may pass. */
  readonly failures: number;
  /** No send or edit follows: frozen for the answer, or stopped after a failure. */
  readonly isDone: boolean;
}

/** What a refresh changes of where its message stands. */
export type ShowingChange = Partial<
  Pick<Showing, "messageId" | "visibleAtMs" | "shownHtml" | "failures" | "isDone">
>;

/** One status message: where it stands, and what its sends and edits share. */
export interface Preview {
  readonly parts: PreviewParts;
  readonly chatId: number;
  readonly startedAtMs: number;
  readonly showing: Showing;
  /** Ends only when the replies close: a send under way runs to its end through a freeze. */
  readonly life: AbortSignal;
}

type Fault = ErrorOptions["cause"];

// Passing failures of the preview in a row before it stops for the turn.
const maxFailures = 3;

function codeOf(error: Fault): string {
  return error instanceof BinferenceError ? error.code : "unexpected";
}

function viewOf(preview: Preview): StatusView {
  const { parts, showing, startedAtMs } = preview;
  const seconds = Math.floor((parts.clock.now() - startedAtMs) / 1_000);
  const { draft } = showing;
  return {
    headline: parts.headline(seconds),
    lines: showing.lines,
    ...(draft === undefined ? {} : { draft }),
  };
}

// One send or edit of the preview: HTML, or its plain text with no parse mode.
async function previewCall(
  preview: Preview,
  text: { readonly body: string; readonly mode: "html" | "plain" },
): Promise<number> {
  const { api } = preview.parts;
  const { chatId } = preview;
  const format = text.mode === "html" ? { parse_mode: "HTML" as const } : {};
  const options = { ...format, link_preview_options: { is_disabled: true } };
  const signal = previewSignal(preview.life);
  const { messageId } = preview.showing;
  if (messageId === undefined) {
    const sent = await callBotApi("sendMessage", signal, async (at) =>
      api.sendMessage(chatId, text.body, options, at),
    );
    return sent.message_id;
  }
  await callBotApi("editMessageText", signal, async (at) =>
    api.editMessageText(chatId, messageId, text.body, options, at),
  );
  return messageId;
}

// HTML Telegram cannot read goes once more as its plain text.
async function sendHtmlOrPlain(preview: Preview, html: ChatHtml): Promise<number> {
  try {
    return await previewCall(preview, { body: html.html, mode: "html" });
  } catch (error) {
    if (!isEntitiesUnparsed(error)) {
      throw error;
    }
    return previewCall(preview, { body: html.plain, mode: "plain" });
  }
}

function shownAs(preview: Preview, messageId: number, html: string): ShowingChange {
  const visibleAtMs = preview.showing.visibleAtMs ?? preview.parts.clock.now();
  return { messageId, visibleAtMs, shownHtml: html, failures: 0 };
}

// Whether a failure may pass: a dropped preview, or an edit's network fault or 5xx, or a first
// send that provably never left. A first send that may have landed would post a second message.
function isPassing(showing: Showing, error: Fault): boolean {
  if (codeOf(error) === "telegram.preview_dropped") {
    return true;
  }
  const isRetryable = error instanceof BinferenceError && error.retryable;
  return showing.messageId === undefined ? isUnsentRequest(error) : isRetryable;
}

function failedWith(preview: Preview, error: Fault): ShowingChange {
  const { showing, parts } = preview;
  if (preview.life.aborted) {
    return {};
  }
  const failures = showing.failures + (codeOf(error) === "telegram.preview_dropped" ? 0 : 1);
  if (isPassing(showing, error) && failures <= maxFailures) {
    return { failures };
  }
  parts.logger.info("telegram.preview_stopped", { errorCode: codeOf(error) });
  return { failures, isDone: true };
}

/**
 * Sends the status message, or edits it, when what it would show changed. A preview the throttler
 * dropped, an edit's network fault or 5xx, or a first send that never left waits for the next
 * refresh, which carries the newest view; after 3 such failures in a row, and at once after any
 * other, the preview stops for the turn and the message keeps what it showed. HTML Telegram
 * cannot read goes as plain text, and an edit that changes nothing counts as shown. A message
 * Telegram no longer has ends the preview. Answers what changed of where the message stands.
 */
export async function refreshPreview(preview: Preview): Promise<ShowingChange> {
  const { showing } = preview;
  const html = statusPreviewOf(viewOf(preview));
  if (showing.isDone || html.html === showing.shownHtml) {
    return {};
  }
  try {
    return shownAs(preview, await sendHtmlOrPlain(preview, html), html.html);
  } catch (error) {
    const { messageId } = showing;
    if (messageId !== undefined && isNotModified(error)) {
      return shownAs(preview, messageId, html.html);
    }
    if (messageId !== undefined && isMessageGone(error)) {
      preview.parts.logger.info("telegram.preview_stopped", { errorCode: codeOf(error) });
      return { isDone: true };
    }
    return failedWith(preview, error);
  }
}
