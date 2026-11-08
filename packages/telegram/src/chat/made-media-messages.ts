import type { Formatter } from "@binference/i18n";
import type { ChatPush, MediaContentType } from "@binference/protocol";
import type { BotCalls } from "../ingress/bot-calls.js";
import { type DepositShowing, shownChat } from "./deposit-photos.js";
import { savedAtCaption } from "./saved-at-caption.js";

/** A `chat/media` push: a video the agent made, or its words spoken (decision 0405). */
export type MediaPush = Extract<ChatPush, { readonly kind: "chat/media" }>;

/** Reads a made medium's bytes from the engine by its id; `undefined` once the engine has none. */
export type MediaReader = (
  made: { readonly agent: string; readonly media: string },
  options: { readonly signal: AbortSignal },
) => Promise<Uint8Array | undefined>;

/** The replies' parts made media are shown with. */
export interface MediaShowing extends Pick<DepositShowing, "showing" | "owner"> {
  readonly bot: BotCalls;
  readonly formatter: () => Formatter;
  /** Where the media's bytes come from; without it, each shows by its path alone. */
  readonly media?: MediaReader;
}

/** The largest file a bot uploads to Telegram: 50 MB. */
const maxUploadBytes = 50_000_000;

const fileNames: Readonly<Record<MediaContentType, string>> = {
  "video/mp4": "video.mp4",
  "audio/ogg": "speech.ogg",
  "audio/mpeg": "speech.mp3",
  "audio/mp4": "speech.m4a",
};

/**
 * Shows a `chat/media` push in the turn's chat, or the owner's when the turn is not followed, read
 * whole from the engine: a video as one Telegram plays in place, captioned with where it was saved,
 * and speech as a voice note with no caption, so the words are heard and never read twice. A
 * medium the engine no longer holds, or one over Telegram's 50 MB, shows as where it was saved. It
 * counts as an answer given.
 */
export async function showMadeMedia(
  replies: MediaShowing,
  push: MediaPush,
  signal: AbortSignal,
): Promise<void> {
  const chatId = await shownChat(replies);
  if (chatId === undefined) {
    return;
  }
  const { media } = push;
  const caption = savedAtCaption(replies.formatter(), media.path);
  // A medium over the upload limit is never read: only its path goes.
  const bytes =
    media.bytes > maxUploadBytes
      ? undefined
      : await replies.media?.({ agent: push.agent, media: media.media }, { signal });
  if (bytes === undefined || bytes.byteLength > maxUploadBytes) {
    await replies.bot.sayRich({ chatId }, caption, { signal });
    return;
  }
  const fileName = fileNames[media.contentType];
  if (media.kind === "video") {
    await replies.bot.sayVideo({ chatId }, { bytes, caption, fileName }, { signal });
    return;
  }
  const voice = { bytes, caption: [], fileName, fallback: caption };
  await replies.bot.sayVoice({ chatId }, voice, { signal });
}
