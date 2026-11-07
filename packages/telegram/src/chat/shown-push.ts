import type { ChatPush } from "@binference/protocol";
import { type ChartPush, showChart } from "./chart-message.js";
import { type DepositPush, type DepositShowing, showDeposit } from "./deposit-photos.js";
import { type MadeImageReader, type MadeImagesPush, showMadeImages } from "./made-photos.js";
import { type SentFileReader, type SentFilesPush, showSentFiles } from "./sent-documents.js";

/** A push of something a tool showed the owner: wallets to fund, a chart, images or files. */
export type ShownPush = DepositPush | ChartPush | MadeImagesPush | SentFilesPush;

const shownKinds: ReadonlySet<string> = new Set([
  "chat/deposit",
  "chat/chart",
  "chat/images",
  "chat/files",
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
  };
}

/**
 * Shows what a tool showed the owner in the turn's chat, or the owner's when the turn is not
 * followed: a `chat/deposit` as photos of its addresses, a `chat/chart` as its text, a
 * `chat/images` as photos of the images the agent made or showed, and a `chat/files` as documents.
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
  if (push.kind === "chat/files") {
    const sentFile = replies.options.sentFile;
    await showSentFiles(
      { ...replies, ...(sentFile === undefined ? {} : { sentFile }) },
      push,
      signal,
    );
    return;
  }
  const reader = replies.options.madeImage;
  await showMadeImages(
    { ...replies, ...(reader === undefined ? {} : { madeImage: reader }) },
    push,
    signal,
  );
}
