import { type ChartPush, showChart } from "./chart-message.js";
import { type DepositPush, type DepositShowing, showDeposit } from "./deposit-photos.js";
import { type MadeImageReader, type MadeImagesPush, showMadeImages } from "./made-photos.js";

/** A push of something a tool showed the owner: wallets to fund, a chart, or images it made. */
export type ShownPush = DepositPush | ChartPush | MadeImagesPush;

/** The replies' parts what a tool shows goes out with. */
export interface ShownReplies extends DepositShowing {
  readonly options: DepositShowing["options"] & { readonly madeImage?: MadeImageReader };
}

/**
 * Shows what a tool showed the owner in the turn's chat, or the owner's when the turn is not
 * followed: a `chat/deposit` as photos of its addresses, a `chat/chart` as its text and a
 * `chat/images` as photos of the images the agent made.
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
  const reader = replies.options.madeImage;
  await showMadeImages(
    { ...replies, ...(reader === undefined ? {} : { madeImage: reader }) },
    push,
    signal,
  );
}
