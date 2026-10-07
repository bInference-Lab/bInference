import { BinferenceError, err, type Id, type Logger, ok, type Result } from "@binference/core";
import type { Card, CardClosing } from "@binference/engine";
import { createFormatter, type MessageLocale } from "@binference/i18n";
import type { AssetInfos } from "@binference/protocol";
import type { Api } from "grammy";
import type { CardAnswers, CardCopyStore, OwnerStore } from "../ports.js";
import type { ButtonPress } from "../updates/chat-update.schema.js";
import { cardCallbackData, cardCallbackSchema } from "./card-callback.schema.js";
import { type CardCalls, createCardCalls, type MessageAt } from "./card-calls.js";
import type { CardCopy } from "./card-copy.js";
import { type CardDisplay, cardHtml, receiptHtml } from "./card-html.js";
import type { CardStanding } from "./card-press.js";

/** One card version to show in the owner's Telegram chat. */
export interface CardShowing {
  readonly intent: Id<"int">;
  /** The card version as the engine drew it. */
  readonly card: Card;
  /** The card version's random reference, stored with it (spec 4, section 2). */
  readonly callbackRef: string;
  /** Every asset the card names, with its symbol, decimals and verdict. */
  readonly assets: AssetInfos;
  /** The agent's topic in the owner's chat. */
  readonly threadId?: number;
}

/** A card version that closed, and how. */
export interface CardSettling {
  readonly ref: string;
  readonly closing: CardClosing;
}

/** Confirmation cards in the owner's Telegram chat, from the card to its receipt. */
export interface TelegramCards {
  /**
   * Sends a card version to the owner's chat with its Confirm and Cancel buttons, keeps the copy,
   * and removes the buttons of the intent's earlier versions. A version shown before is not sent
   * again. `no_owner` before an owner is bound.
   */
  show(
    showing: CardShowing,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<CardCopy, "no_owner">>;
  /**
   * Edits every Telegram copy of a card version into the receipt of its closing and removes the
   * buttons: for an answer on another surface, the card timer, or an answer here.
   */
  settle(settling: CardSettling, options: { readonly signal: AbortSignal }): Promise<void>;
  /**
   * Takes the owner's press of a card button. Data in any other form than a card button's does
   * nothing. Otherwise the engine stores the answer first; then the press is answered, and a
   * closed card becomes its receipt. A card that stays open says why, when it knows.
   */
  press(press: ButtonPress, options: { readonly signal: AbortSignal }): Promise<void>;
}

/** What {@link createTelegramCards} needs. */
export interface TelegramCardsOptions {
  /** The bot's grammY `Api`, with the token's throttler installed. */
  readonly api: Api;
  readonly owners: OwnerStore;
  readonly copies: CardCopyStore;
  /** The engine's side: it checks the presser and stores each answer. */
  readonly answers: CardAnswers;
  readonly logger: Logger;
  /** The owner's language and timezone: cards, receipts and times follow them. */
  readonly display: { readonly locale: MessageLocale; readonly timeZone: string };
}

interface Call {
  readonly signal: AbortSignal;
}

interface CardsContext {
  readonly options: TelegramCardsOptions;
  readonly calls: CardCalls;
  readonly words: (key: string) => string;
  readonly displayOf: (assets: AssetInfos) => CardDisplay;
}

function buttonsOf(context: CardsContext, ref: string) {
  return [
    {
      text: context.words("telegram.button.confirm"),
      data: cardCallbackData({ ref, decision: "confirm" }),
    },
    {
      text: context.words("telegram.button.cancel"),
      data: cardCallbackData({ ref, decision: "deny" }),
    },
  ];
}

async function show(
  context: CardsContext,
  showing: CardShowing,
  call: Call,
): Promise<Result<CardCopy, "no_owner">> {
  const { copies, owners, logger } = context.options;
  const ref = showing.callbackRef;
  const [shown] = await copies.find(ref, call);
  if (shown !== undefined) {
    return ok(shown);
  }
  const owner = await owners.get(call);
  if (owner === undefined) {
    return err("no_owner");
  }
  const messageId = await context.calls.send(
    {
      chatId: owner.userId,
      ...(showing.threadId === undefined ? {} : { threadId: showing.threadId }),
      html: cardHtml(showing.card, context.displayOf(showing.assets)),
      buttons: buttonsOf(context, ref),
    },
    call,
  );
  const copy = {
    ref,
    intent: showing.intent,
    cardVersion: showing.card.version,
    chatId: owner.userId,
    messageId,
  };
  await copies.keep(copy, call);
  logger.info("telegram.card_shown", { intentId: showing.intent });
  const earlier = (await copies.ofIntent(showing.intent, call)).filter(
    (kept) => kept.cardVersion < copy.cardVersion,
  );
  await Promise.all(earlier.map(async (old) => context.calls.dropButtons(old, call)));
  return ok(copy);
}

function sameMessage(left: MessageAt, right: MessageAt): boolean {
  return left.chatId === right.chatId && left.messageId === right.messageId;
}

/** A closing to settle, and the message a press came from, when one did. */
interface Settling extends CardSettling {
  readonly pressed?: MessageAt;
}

// Every copy kept for the version, and the message pressed when the store lost track of it.
async function settle(context: CardsContext, settling: Settling, call: Call): Promise<void> {
  const { pressed } = settling;
  const kept: readonly MessageAt[] = await context.options.copies.find(settling.ref, call);
  const isKept = pressed === undefined || kept.some((copy) => sameMessage(copy, pressed));
  const extra = isKept ? [] : [pressed];
  const html = receiptHtml(settling.closing, context.displayOf({}));
  await Promise.all(
    [...kept, ...extra].map(async (copy) => context.calls.receipt(copy, html, call)),
  );
}

/** A press the engine answered, and how the card stands after it. */
interface Pressed {
  readonly press: ButtonPress;
  readonly standing: CardStanding;
}

function noticeOf(context: CardsContext, standing: CardStanding): string | undefined {
  return standing.status === "open" && standing.reason !== undefined
    ? context.words(`reason.${standing.reason}`)
    : undefined;
}

// The answer is stored by now; a press Telegram no longer takes an answer for only spins on.
async function answerPress(context: CardsContext, pressed: Pressed, call: Call): Promise<void> {
  try {
    const notice = noticeOf(context, pressed.standing);
    await context.calls.answer(pressed.press.callbackId, notice, call);
  } catch (error) {
    call.signal.throwIfAborted();
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    context.options.logger.warn("telegram.press_answer_failed", { errorCode });
  }
}

async function press(context: CardsContext, pressed: ButtonPress, call: Call): Promise<void> {
  const callback = cardCallbackSchema.safeParse(pressed.data ?? "");
  if (!callback.success || callback.data.decision === "details") {
    return;
  }
  const { ref, decision } = callback.data;
  const answer = { ref, decision, presserId: pressed.sender.id };
  const standing = await context.options.answers.answer(answer, call);
  if (standing.status === "unknown") {
    return;
  }
  await answerPress(context, { press: pressed, standing }, call);
  if (standing.status === "closed") {
    const { chatId, messageId } = pressed;
    const at =
      chatId === undefined || messageId === undefined ? {} : { pressed: { chatId, messageId } };
    await settle(context, { ref, closing: standing.closing, ...at }, call);
  }
}

/**
 * Creates the owner's confirmation cards in Telegram (spec 4, sections 2 and 3). Every value from
 * outside is escaped, buttons carry `bnf1:c:<decision>:<ref>` data, the engine checks the presser
 * and stores the answer before Telegram hears back, and the first answer, from any surface, turns
 * every copy into its receipt.
 */
export function createTelegramCards(options: TelegramCardsOptions): TelegramCards {
  const formatter = createFormatter(options.display);
  const context: CardsContext = {
    options,
    calls: createCardCalls(options.api),
    // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
    words: (key) => formatter.message(key),
    displayOf: (assets) => ({ formatter, assets }),
  };
  return {
    show: async (showing, call) => show(context, showing, call),
    settle: async (settling, call) => settle(context, settling, call),
    press: async (pressed, call) => press(context, pressed, call),
  };
}
