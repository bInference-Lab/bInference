import type { RichLine } from "@binference/rich-text";
import { type Api, InputFile } from "grammy";
import { isEntitiesUnparsed } from "../api/bot-api-error.schema.js";
import { callBotApi } from "../api/call-bot-api.js";
import { richHtmlOf, richPlainOf } from "../format/rich-html.js";
import type { ReplyTarget } from "./decide-update.js";

/** The Bot API methods that upload a file the bot sends. */
export type FileMethod = "sendPhoto" | "sendDocument" | "sendVideo" | "sendVoice";

/** A file the bot uploads: its bytes, its caption's lines, none for no caption, and its name. */
export interface UploadedFile {
  readonly bytes: Uint8Array;
  readonly caption: readonly RichLine[];
  readonly fileName: string;
  /** The lines that go as a message when Telegram refuses the file; the caption when absent. */
  readonly fallback?: readonly RichLine[];
}

/** Sends lines as a message, as `BotCalls.sayRich` does. */
type SayRich = (
  target: ReplyTarget,
  lines: readonly RichLine[],
  options: { readonly signal: AbortSignal },
) => Promise<void>;

/** One upload as it goes: the method, where, the file and its caption's text. */
interface Upload {
  readonly method: FileMethod;
  readonly target: ReplyTarget;
  readonly bytes: Uint8Array;
  readonly fileName: string;
  /** The caption's text, none when empty. */
  readonly caption: string;
}

// The method's call on grammY's `Api`, with a video marked playable while it streams.
async function sent(
  api: Api,
  upload: Upload,
  call: {
    readonly other: {
      readonly message_thread_id?: number;
      readonly caption?: string;
      readonly parse_mode?: "HTML";
    };
    readonly signal: Parameters<Api["sendPhoto"]>[3];
  },
): Promise<void> {
  const file = new InputFile(upload.bytes, upload.fileName);
  const { chatId } = upload.target;
  const { other, signal } = call;
  switch (upload.method) {
    case "sendPhoto":
      await api.sendPhoto(chatId, file, other, signal);
      return;
    case "sendDocument":
      await api.sendDocument(chatId, file, other, signal);
      return;
    case "sendVideo":
      await api.sendVideo(chatId, file, { ...other, supports_streaming: true }, signal);
      return;
    case "sendVoice":
      await api.sendVoice(chatId, file, other, signal);
  }
}

// A file's caption as HTML, or as plain text when Telegram cannot parse the HTML.
async function sendFileOnce(
  api: Api,
  upload: Upload,
  options: { readonly signal: AbortSignal; readonly isHtml: boolean },
): Promise<void> {
  const { target, caption } = upload;
  const thread = target.threadId === undefined ? {} : { message_thread_id: target.threadId };
  const mode = options.isHtml ? { parse_mode: "HTML" as const } : {};
  const other = caption === "" ? thread : { ...thread, caption, ...mode };
  await callBotApi(upload.method, options.signal, async (signal) =>
    sent(api, upload, { other, signal }),
  );
}

/**
 * A file with its caption: as HTML, again as plain text when Telegram cannot parse it, and as its
 * fallback lines, or its caption, when Telegram refuses the file.
 */
export function sayFileWith(api: Api, method: FileMethod, sayRich: SayRich) {
  return async (
    target: ReplyTarget,
    file: UploadedFile,
    options: { readonly signal: AbortSignal },
  ): Promise<void> => {
    const { bytes, caption, fileName } = file;
    const { signal } = options;
    const upload = { method, target, bytes, fileName };
    try {
      await sendFileOnce(
        api,
        { ...upload, caption: richHtmlOf(caption) },
        { signal, isHtml: true },
      );
    } catch (error) {
      signal.throwIfAborted();
      if (isEntitiesUnparsed(error)) {
        await sendFileOnce(
          api,
          { ...upload, caption: richPlainOf(caption) },
          { signal, isHtml: false },
        );
        return;
      }
      await sayRich(target, file.fallback ?? caption, options);
    }
  };
}
