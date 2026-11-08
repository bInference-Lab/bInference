import type { ChatPush } from "@binference/protocol";
import { type ChartPush, showChart } from "./chart-message.js";
import { type DepositPush, type DepositShowing, showDeposit } from "./deposit-photos.js";
import { type MediaPush, type MediaReader, showMadeMedia } from "./made-media-messages.js";
import { type MadeImageReader, type MadeImagesPush, showMadeImages } from "./made-photos.js";
import { type SentFileReader, type SentFilesPush, showSentFiles } from "./sent-documents.js";

/** A push of something a tool showed the owner: wallets to fund, a chart, images, files or media. */
export type ShownPush = DepositPush | ChartPush | MadeImagesPush | SentFilesPush | MediaPush;

const shownKinds: ReadonlySet<string> = new Set([
  "chat/deposit",
  "chat/chart",
  "chat/images",
  "chat/files",
  "chat/media",
]);

/** Whether a chat push is something a tool showed mid-turn. */
export function isShownPush(push: ChatPush): push is ShownPush {
  return shownKinds.has(push.kind);
}

/** The replies' parts what a tool shows goes out with. */
export interface ShownReplies extends DepositShowing {
  readonly options: DepositShowing["options"] & {
    readonly madeImage?: MadeImageReader;
    readonly sentFile?: SentFileReader;
    readonly media?: MediaReader;
  };
}

// The pushes whose files the engine answers in parts: images, files and made media.
async function showReadPush(
  replies: ShownReplies,
  push: MadeImagesPush | SentFilesPush | MediaPush,
  signal: AbortSignal,
): Promise<void> {
  const { madeImage, sentFile, media } = replies.options;
  if (push.kind === "chat/files") {
    await showSentFiles(
      { ...replies, ...(sentFile === undefined ? {} : { sentFile }) },
      push,
      signal,
    );
    return;
  }
  if (push.kind === "chat/media") {
    await showMadeMedia({ ...replies, ...(media === undefined ? {} : { media }) }, push, signal);
    return;
  }
  await showMadeImages(
    { ...replies, ...(madeImage === undefined ? {} : { madeImage }) },
    push,
    signal,
  );
}

/**
 * Shows what a tool showed the owner in the turn's chat, or the owner's when the turn is not
 * followed: a `chat/deposit` as photos of its addresses, a `chat/chart` as its text, a
 * `chat/images` as photos of the images the agent made or showed, a `chat/files` as documents, and
 * a `chat/media` as a video or a voice note (decision 0405).
 */
export async function showShown(
  replies: ShownReplies,
  push: ShownPush,
  signal: AbortSignal,
): Promise<void> {
  if (push.kind === "chat/deposit") {
    await showDeposit(replies, push, signal);
    return;
  }
  if (push.kind === "chat/chart") {
    await showChart(replies, push, signal);
    return;
  }
  await showReadPush(replies, push, signal);
}
