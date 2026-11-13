import type { Formatter } from "@binference/i18n";
import type { ChatPush } from "@binference/protocol";
import { qrPng } from "@binference/qr";
import { depositLines, walletAddressOf } from "../commands/deposit-lines.js";
import type { BotCalls } from "../ingress/bot-calls.js";

/** A `chat/deposit` push: the wallets the agent showed the owner, with its mode and freeze. */
export type DepositPush = Extract<ChatPush, { readonly kind: "chat/deposit" }>;

/** Where the photos go and what their captions are written with. */
interface DepositSending {
  readonly bot: BotCalls;
  readonly chatId: number;
  readonly formatter: Formatter;
}

/*
 * Sends the wallets of a `chat/deposit` push to the owner's chat (decision 0380), one photo each,
 * in order: the QR code of the address the engine read from custody, captioned as `/wallet`
 * captions it. The engine never pushes a wallet nothing runs from.
 */
async function sendDepositPhotos(
  sending: DepositSending,
  push: DepositPush,
  signal: AbortSignal,
): Promise<void> {
  const { bot, chatId, formatter } = sending;
  const words = (key: string, values?: Parameters<Formatter["message"]>[1]): string => {
    // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
    return formatter.message(key, values);
  };
  const parts = { words, formatter };
  await push.wallets.reduce(async (previous, view) => {
    await previous;
    const isBraked = push.breaker === true;
    const caption = depositLines(parts, { view, mode: push.mode, isFrozen: push.frozen, isBraked });
    await bot.sayPhoto({ chatId }, { png: qrPng(walletAddressOf(view)), caption }, { signal });
  }, Promise.resolve());
}

/** The replies' parts a deposit is shown with: the turn's showing, if any, and the owner's chat. */
export interface DepositShowing {
  readonly bot: BotCalls;
  readonly formatter: () => Formatter;
  readonly showing: { readonly chatId: number; readonly reply: { isGiven: boolean } } | undefined;
  readonly owner: () => Promise<number | undefined>;
}

/**
 * The chat what a tool shows goes to: the turn's, or the owner's when the turn is not followed.
 * It counts as an answer given, so the turn does not end saying the agent answered nothing.
 */
export async function shownChat(
  replies: Pick<DepositShowing, "showing" | "owner">,
): Promise<number | undefined> {
  const { showing } = replies;
  if (showing !== undefined) {
    showing.reply.isGiven = true;
  }
  return showing?.chatId ?? (await replies.owner());
}

/**
 * Shows a `chat/deposit` push in the turn's chat, or the owner's when the turn is not followed,
 * and counts it as an answer given, so the turn does not end saying the agent answered nothing.
 */
export async function showDeposit(
  replies: DepositShowing,
  push: DepositPush,
  signal: AbortSignal,
): Promise<void> {
  const chatId = await shownChat(replies);
  if (chatId === undefined) {
    return;
  }
  const sending = { bot: replies.bot, chatId, formatter: replies.formatter() };
  await sendDepositPhotos(sending, push, signal);
}
