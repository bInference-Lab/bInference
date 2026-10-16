import {
  BinferenceError,
  err,
  type HttpDownload,
  ok,
  type Result,
  type Secret,
} from "@binference/core";
import type { ImageRefusal, OwnerImageSource } from "@binference/engine/chat";
import { maxImageBytes } from "@binference/protocol";
import { type Api, GrammyError } from "grammy";
import { assertGrammySignal } from "../api/assert-grammy-signal.js";
import { botApiFault } from "../api/bot-api-error.schema.js";

/** What the bot reads the owner's photos through. */
export interface TelegramImagesOptions {
  /** The bot's grammY `Api`, with its throttler installed, which `getFile` goes through. */
  readonly api: Pick<Api, "getFile">;
  /** binference's outbound HTTP, which downloads each file as bytes. */
  readonly download: HttpDownload;
  /** The bot token, which the file's link holds. */
  readonly token: Secret;
  /** The Bot API server; Telegram's own when absent. */
  readonly apiRoot?: string;
}

/** The prefix of an image the owner sent the bot (protocol spec, section 7.7). */
const prefix = "tg:";
const defaultApiRoot = "https://api.telegram.org";
// Telegram's words for a file over the 20 MB `getFile` serves.
const fileTooBig = /file is too big/iu;
const badRequest = 400;

// Telegram out of reach, or refusing for a reason of its own: the call may be tried again. The
// cause stays out, since the link and the Bot API's error hold the token.
function unreachable(method: string, status?: number): BinferenceError {
  return new BinferenceError({
    code: "telegram.unreachable",
    message: `Telegram did not give the file at ${method}.`,
    retryable: true,
    details: { method, ...(status === undefined ? {} : { status }) },
  });
}

interface TelegramFile {
  readonly path: string;
  readonly size?: number;
}

async function fileOf(
  options: TelegramImagesOptions,
  fileId: string,
  signal: AbortSignal,
): Promise<Result<TelegramFile, ImageRefusal>> {
  try {
    const file = await options.api.getFile(fileId, assertGrammySignal(signal));
    const size = file.file_size === undefined ? {} : { size: file.file_size };
    return file.file_path === undefined ? err("unreadable") : ok({ path: file.file_path, ...size });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof GrammyError && error.error_code === badRequest) {
      return err(fileTooBig.test(error.description) ? "too_large" : "unreadable");
    }
    const fault = botApiFault(error, "getFile");
    throw fault.code === "telegram.unreachable" ? fault : unreachable("getFile");
  }
}

async function bytesOf(
  options: TelegramImagesOptions,
  path: string,
  signal: AbortSignal,
): Promise<Result<Uint8Array, ImageRefusal>> {
  const root = options.apiRoot ?? defaultApiRoot;
  const url = `${root}/file/bot${options.token.reveal()}/${path}`;
  try {
    const answer = await options.download.download({ url, maxBytes: maxImageBytes, signal });
    if (answer.status === 200) {
      return ok(answer.bytes);
    }
    if (answer.status === 404 || answer.status === badRequest) {
      return err("unreadable");
    }
    throw unreachable("download", answer.status);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof BinferenceError && error.code === "http.answer_too_large") {
      return err("too_large");
    }
    throw error instanceof BinferenceError && error.code === "telegram.unreachable"
      ? error
      : unreachable("download");
  }
}

/**
 * The owner's photos as the bot reads them (decision 0227): `getFile` through the bot's throttled
 * client, then the file's bytes through binference's outbound HTTP. A file over 5 MiB by
 * Telegram's own count is `too_large` before any download, and so is a download that passes 5 MiB.
 * A file id Telegram refuses is `unreadable`, `too_large` when Telegram says the file is too big;
 * a name without `tg:` is `unreadable`. Telegram out of reach throws a retryable
 * `telegram.unreachable`. The link holds the bot token: it is never logged, and no error carries
 * it.
 */
export function createTelegramImages(options: TelegramImagesOptions): OwnerImageSource {
  return {
    async read(image, call) {
      call.signal.throwIfAborted();
      if (!image.startsWith(prefix)) {
        return err("unreadable");
      }
      const file = await fileOf(options, image.slice(prefix.length), call.signal);
      if (!file.ok) {
        return file;
      }
      if ((file.value.size ?? 0) > maxImageBytes) {
        return err("too_large");
      }
      return bytesOf(options, file.value.path, call.signal);
    },
  };
}
