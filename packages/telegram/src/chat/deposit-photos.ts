import type { ChainRegistry } from "@binference/chain";
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
  /** The registry that names each wallet's chain and explorer; left out, the engine's chain name. */
  readonly chains?: ChainRegistry;
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
  const { bot, chatId, formatter, chains } = sending;
  const words = (key: string, values?: Parameters<Formatter["message"]>[1]): string => {
    // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
    return formatter.message(key, values);
  };
  const parts = { words, formatter, ...(chains === undefined ? {} : { chains }) };
  await push.wallets.reduce(async (previous, view) => {
    await previous;
    const caption = depositLines(parts, { view, mode: push.mode, isFrozen: push.frozen });
    await bot.sayPhoto({ chatId }, { png: qrPng(walletAddressOf(view)), caption }, { signal });
  }, Promise.resolve());
}

/** The replies' parts a deposit is shown with: the turn's showing, if any, and the owner's chat. */
export interface DepositShowing {
  readonly options: { readonly chains?: ChainRegistry };
  readonly bot: BotCalls;
  readonly formatter: () => Formatter;
  readonly showing: { readonly chatId: number; readonly reply: { isGiven: boolean } } | undefined;
  readonly owner: () => Promise<number | undefined>;
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
  const { showing, options } = replies;
  const chatId = showing?.chatId ?? (await replies.owner());
  if (showing !== undefined) {
    showing.reply.isGiven = true;
  }
  if (chatId === undefined) {
    return;
  }
  const chains = options.chains === undefined ? {} : { chains: options.chains };
  const sending = { bot: replies.bot, chatId, formatter: replies.formatter(), ...chains };
  await sendDepositPhotos(sending, push, signal);
}
