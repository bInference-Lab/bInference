import type { Formatter } from "@binference/i18n";
import type { ChatPush } from "@binference/protocol";
import type { BotCalls } from "../ingress/bot-calls.js";
import { type DepositShowing, shownChat } from "./deposit-photos.js";
import { savedAtCaption } from "./saved-at-caption.js";

/** A `chat/files` push: files on the machine the agent sent the owner (decision 0400). */
export type SentFilesPush = Extract<ChatPush, { readonly kind: "chat/files" }>;

/** Reads a sent file's bytes from the engine by its id; `undefined` once the engine has none. */
export type SentFileReader = (
  sent: { readonly agent: string; readonly file: string },
  options: { readonly signal: AbortSignal },
) => Promise<Uint8Array | undefined>;

/** The replies' parts sent files are shown with. */
export interface SentShowing extends Pick<DepositShowing, "showing" | "owner"> {
  readonly bot: BotCalls;
  readonly formatter: () => Formatter;
  /** Where the documents' bytes come from; without it, the files show by their paths alone. */
  readonly sentFile?: SentFileReader;
}

/**
 * Shows a `chat/files` push in the turn's chat, or the owner's when the turn is not followed: one
 * document per file, in order, read whole from the engine, named as on the machine and captioned
 * with where it is. A file the engine no longer holds shows as its caption alone. It counts as an
 * answer given.
 */
export async function showSentFiles(
  replies: SentShowing,
  push: SentFilesPush,
  signal: AbortSignal,
): Promise<void> {
  const chatId = await shownChat(replies);
  if (chatId === undefined) {
    return;
  }
  const formatter = replies.formatter();
  await push.files.reduce(async (previous, sent) => {
    await previous;
    const caption = savedAtCaption(formatter, sent.path);
    const bytes = await replies.sentFile?.({ agent: push.agent, file: sent.file }, { signal });
    if (bytes === undefined) {
      await replies.bot.sayRich({ chatId }, caption, { signal });
      return;
    }
    await replies.bot.sayDocument({ chatId }, { bytes, caption, fileName: sent.name }, { signal });
  }, Promise.resolve());
}
