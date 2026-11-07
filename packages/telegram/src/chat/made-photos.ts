import type { Formatter } from "@binference/i18n";
import type { ChatPush, ImageContentType } from "@binference/protocol";
import type { RichLine } from "@binference/rich-text";
import type { BotCalls } from "../ingress/bot-calls.js";
import { type DepositShowing, shownChat } from "./deposit-photos.js";

/** A `chat/images` push: the images the agent made, saved in its workspace (decision 0392). */
export type MadeImagesPush = Extract<ChatPush, { readonly kind: "chat/images" }>;

/** Reads a made image's bytes from the engine by its id; `undefined` once the engine has none. */
export type MadeImageReader = (
  made: { readonly agent: string; readonly image: string },
  options: { readonly signal: AbortSignal },
) => Promise<Uint8Array | undefined>;

/** The replies' parts made images are shown with. */
export interface MadeShowing extends Pick<DepositShowing, "showing" | "owner"> {
  readonly bot: BotCalls;
  readonly formatter: () => Formatter;
  /** Where the photos' bytes come from; without it, the images show by their paths alone. */
  readonly madeImage?: MadeImageReader;
}

/** The largest photo Telegram takes from a bot: 10 MB. */
const maxPhotoBytes = 10_000_000;

const fileNames: Readonly<Record<ImageContentType, string>> = {
  "image/png": "image.png",
  "image/jpeg": "image.jpg",
  "image/webp": "image.webp",
};

// The caption: where the image was saved, in `code`, as the agent's workspace holds it.
function captionOf(formatter: Formatter, path: string): readonly RichLine[] {
  // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
  const label = formatter.message("telegram.chat.madeImage");
  return [
    {
      block: { kind: "text" },
      runs: [
        { text: `${label} `, marks: [] },
        { text: path, marks: [{ kind: "code" }] },
      ],
    },
  ];
}

/**
 * Shows a `chat/images` push in the turn's chat, or the owner's when the turn is not followed, as
 * it usually is, since a job ends after its turn: one photo per image, in order, read whole from
 * the engine and captioned with where it was saved. An image the engine no longer holds, or one
 * over Telegram's 10 MB, shows as its caption alone. It counts as an answer given.
 */
export async function showMadeImages(
  replies: MadeShowing,
  push: MadeImagesPush,
  signal: AbortSignal,
): Promise<void> {
  const chatId = await shownChat(replies);
  if (chatId === undefined) {
    return;
  }
  const formatter = replies.formatter();
  await push.images.reduce(async (previous, made) => {
    await previous;
    const caption = captionOf(formatter, made.path);
    const bytes = await replies.madeImage?.({ agent: push.agent, image: made.image }, { signal });
    if (bytes === undefined || bytes.byteLength > maxPhotoBytes) {
      await replies.bot.sayRich({ chatId }, caption, { signal });
      return;
    }
    const photo = { png: bytes, caption, fileName: fileNames[made.contentType] };
    await replies.bot.sayPhoto({ chatId }, photo, { signal });
  }, Promise.resolve());
}
