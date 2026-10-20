import type { Api } from "grammy";
import { callBotApi } from "../api/call-bot-api.js";

// The prefix of a photo's name in the owner's messages (decision 0178).
const botPrefix = "tg:";

/**
 * Sends the owner's photo a launch draft holds back to the owner's chat by its Telegram file id,
 * the same file the engine read (decision 0286): as a photo, or as a document when the owner sent
 * it as a file, which Telegram refuses to send as a photo. Answers the message's id, or
 * `undefined` when Telegram sent neither. Once the signal aborts, it rejects with its reason.
 */
export async function sendDraftPhoto(
  api: Api,
  photo: { readonly chatId: number; readonly image: string },
  signal: AbortSignal,
): Promise<number | undefined> {
  if (!photo.image.startsWith(botPrefix)) {
    return undefined;
  }
  const fileId = photo.image.slice(botPrefix.length);
  const asPhoto = await callBotApi("sendPhoto", signal, async (stop) =>
    api.sendPhoto(photo.chatId, fileId, {}, stop),
  ).catch(() => undefined);
  signal.throwIfAborted();
  if (asPhoto !== undefined) {
    return asPhoto.message_id;
  }
  const asFile = await callBotApi("sendDocument", signal, async (stop) =>
    api.sendDocument(photo.chatId, fileId, {}, stop),
  ).catch(() => undefined);
  signal.throwIfAborted();
  return asFile?.message_id;
}
