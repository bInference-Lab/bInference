import { BinferenceError } from "@binference/core";
import { isEntitiesUnparsed, isNotModified } from "../api/bot-api-error.schema.js";
import { callBotApi } from "../api/call-bot-api.js";
import { type ChatHtml, chatHtmlOf } from "./chat-html.js";
import { createPreviewMessage, type PreviewMessage } from "./preview-message.js";
import { compactLine, maxLineChars } from "./progress-lines.js";
import { createReasoningLane } from "./reasoning-lane.js";
import { resendUnsent } from "./resend-unsent.js";
import type { StatusMessage, StatusParts } from "./status-message.js";
import { statusPreviewOf } from "./status-preview.js";

// A first send waits for this many characters of the answer, so a notification never carries a
// word or two.
const leastFirstChars = 30;

// The final words in place of the preview: HTML, or its plain text when Telegram cannot parse it.
async function editInto(
  parts: StatusParts,
  at: { readonly chatId: number; readonly messageId: number; readonly piece: ChatHtml },
  signal: AbortSignal,
): Promise<void> {
  const { api, clock } = parts;
  const edit = async (text: string, mode: "html" | "plain"): Promise<void> => {
    const format = mode === "html" ? { parse_mode: "HTML" as const } : {};
    const options = { ...format, link_preview_options: { is_disabled: true } };
    await resendUnsent(
      async () =>
        callBotApi("editMessageText", signal, async (sent) =>
          api.editMessageText(at.chatId, at.messageId, text, options, sent),
        ),
      { clock, signal },
    );
  };
  try {
    await edit(at.piece.html, "html");
  } catch (error) {
    if (!isEntitiesUnparsed(error)) {
      throw error;
    }
    await edit(at.piece.plain, "plain");
  }
}

// Edits the shown preview into the answer's first message; one that changes nothing counts.
async function finishedInPlace(
  parts: StatusParts,
  at: { readonly chatId: number; readonly preview: PreviewMessage; readonly first: ChatHtml },
  signal: AbortSignal,
): Promise<boolean> {
  await at.preview.freeze();
  const { messageId } = at.preview.current();
  if (messageId === undefined) {
    return false;
  }
  try {
    await editInto(parts, { chatId: at.chatId, messageId, piece: at.first }, signal);
    return true;
  } catch (error) {
    if (isNotModified(error)) {
      return true;
    }
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    parts.logger.info("telegram.preview_not_finished", { errorCode });
    return false;
  }
}

/**
 * Creates a turn's answer preview for the `partial` reply mode (decision 0376): the answer as the
 * agent writes it, in one message edited at most once a second, first sent once it holds 30
 * characters, showing its first 4,000; while a tool runs and no text is being written, the fixed
 * label or the text written before the tool. At the end the message becomes the answer's first
 * message in place, and only a failed edit leaves it to be deleted.
 */
export function createAnswerPreview(parts: StatusParts, chatId: number): StatusMessage {
  let [draft, headline, hasWork, isKept] = ["", "", false, false];
  const message = createPreviewMessage(parts, {
    chatId,
    view: () => {
      const [page] = chatHtmlOf(draft);
      const isShown = message.current().messageId !== undefined;
      if (page !== undefined && (isShown || page.plain.length >= leastFirstChars)) {
        return page;
      }
      const status = { label: parts.label(), ...(headline === "" ? {} : { headline }) };
      return hasWork ? statusPreviewOf(status) : undefined;
    },
  });
  const lane = createReasoningLane(parts, chatId);
  return {
    freeze: async () => Promise.all([message.freeze(), lane.freeze()]).then(() => undefined),
    replaceWith: async (text, signal) => message.replaceWith(text, signal),
    remove: async () => {
      await Promise.all([isKept ? Promise.resolve() : message.remove(), lane.remove()]);
    },
    idle: async () => {
      await Promise.all([message.idle(), lane.idle()]);
    },
    close: () => {
      message.close();
      lane.close();
    },
    think: (text) => lane.take(text),
    draft(text) {
      draft = text;
      if ((chatHtmlOf(text)[0]?.plain.length ?? 0) >= leastFirstChars) {
        message.wake();
      }
    },
    work() {
      const said = compactLine(draft, maxLineChars);
      [headline, draft, hasWork] = [said === "" ? headline : said, "", true];
      message.wake();
    },
    finishInPlace: async (first, signal) => {
      isKept = await finishedInPlace(parts, { chatId, preview: message, first }, signal);
      return isKept;
    },
  };
}
