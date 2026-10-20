import { BinferenceError, type Clock, err, type Logger, ok, type Result } from "@binference/core";
import type {
  CardCopy,
  CardCopyStore,
  CardSettling,
  CardShowing as DrawnCard,
  CardStanding,
  OwnerStore,
  ReceiptAfter,
} from "@binference/engine/surfaces";
import type { MessageLocale } from "@binference/i18n";
import type { AssetInfos } from "@binference/protocol";
import type { Api } from "grammy";
import { createOwnerFormatters } from "../format/owner-formatters.js";
import { type BotCalls, createBotCalls } from "../ingress/bot-calls.js";
import type { CardAnswers } from "../ports.js";
import type { ButtonPress } from "../updates/chat-update.schema.js";
import { cardCallbackData, cardCallbackSchema } from "./card-callback.schema.js";
import { type CardCalls, createCardCalls, type MessageAt } from "./card-calls.js";
import { type CardDisplay, cardHtml, receiptHtml } from "./card-html.js";

/** One card version to show in the owner's Telegram chat, as the engine draws it. */
export interface CardShowing extends DrawnCard {
  /** The agent's topic in the owner's chat. */
  readonly threadId?: number;
}

/** Confirmation cards in the owner's Telegram chat, from the card to its receipt. */
export interface TelegramCards {
  /**
   * Sends a card version to the owner's chat with its Confirm and Cancel buttons, keeps the copy,
   * and removes the buttons of the intent's earlier versions. A version shown before, or being
   * shown, is not sent again: the copy is answered. `no_owner` before an owner is bound.
   */
  show(
    showing: CardShowing,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<CardCopy, "no_owner">>;
  /**
   * Sends an open card version to the owner's chat again, with its Cancel button alone, and keeps
   * the copy, so it becomes the receipt like every other: what `/cancel` offers. `no_owner`
   * before an owner is bound.
   */
  offerCancel(
    showing: CardShowing,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<CardCopy, "no_owner">>;
  /**
   * Edits every Telegram copy of a card version into the receipt of its closing, or of its paper
   * fill, and removes the buttons: for an answer on another surface, the card timer, or an answer
   * here.
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
  /** Dates each copy kept as the time its message was sent. */
  readonly clock: Clock;
  readonly logger: Logger;
  /**
   * The owner's language and timezone as they are now: cards, receipts and times follow them, read
   * again for each message.
   */
  readonly display: () => { readonly locale: MessageLocale; readonly timeZone: string };
}

interface Call {
  readonly signal: AbortSignal;
}

interface CardsContext {
  readonly options: TelegramCardsOptions;
  readonly calls: CardCalls;
  readonly bot: BotCalls;
  readonly words: (key: string) => string;
  readonly displayOf: (assets: AssetInfos) => CardDisplay;
}

type Decision = "confirm" | "deny";

const buttonWords: Readonly<Record<Decision, string>> = {
  confirm: "telegram.button.confirm",
  deny: "telegram.button.cancel",
};

function buttonsOf(context: CardsContext, ref: string, decisions: readonly Decision[]) {
  return decisions.map((decision) => ({
    text: context.words(buttonWords[decision]),
    data: cardCallbackData({ ref, decision }),
  }));
}

// Sends the card version with the buttons of these decisions and keeps the copy.
async function send(
  context: CardsContext,
  sending: { readonly showing: CardShowing; readonly decisions: readonly Decision[] },
  call: Call,
): Promise<Result<CardCopy, "no_owner">> {
  const { copies, owners, clock, logger } = context.options;
  const { showing } = sending;
  const owner = await owners.get(call);
  if (owner === undefined) {
    return err("no_owner");
  }
  const ref = showing.callbackRef;
  const messageId = await context.calls.send(
    {
      chatId: owner.userId,
      ...(showing.threadId === undefined ? {} : { threadId: showing.threadId }),
      html: cardHtml(showing.card, context.displayOf(showing.assets)),
      buttons: buttonsOf(context, ref, sending.decisions),
    },
    call,
  );
  const copy = {
    ref,
    intent: showing.intent,
    cardVersion: showing.card.version,
    chatId: owner.userId,
    messageId,
    sentAtMs: clock.now(),
  };
  await copies.keep(copy, call);
  logger.info("telegram.card_shown", { intentId: showing.intent });
  return ok(copy);
}

async function show(
  context: CardsContext,
  showing: CardShowing,
  call: Call,
): Promise<Result<CardCopy, "no_owner">> {
  const { copies } = context.options;
  const [shown] = await copies.find(showing.callbackRef, call);
  if (shown !== undefined) {
    return ok(shown);
  }
  const sent = await send(context, { showing, decisions: ["confirm", "deny"] }, call);
  if (!sent.ok) {
    return sent;
  }
  const copy = sent.value;
  const earlier = (await copies.ofIntent(showing.intent, call)).filter(
    (kept) => kept.cardVersion < copy.cardVersion,
  );
  await Promise.all(earlier.map(async (old) => context.calls.dropButtons(old, call)));
  return ok(copy);
}

// One showing of a card version at a time: a second asks while the first sends, and gets its copy,
// so the relay and a command never post the same version twice.
function oneShowAtATime(context: CardsContext): TelegramCards["show"] {
  const showing = new Map<string, Promise<Result<CardCopy, "no_owner">>>();
  return async (card, call) => {
    const running = showing.get(card.callbackRef);
    if (running !== undefined) {
      return running;
    }
    const shown = show(context, card, call);
    showing.set(card.callbackRef, shown);
    try {
      return await shown;
    } finally {
      showing.delete(card.callbackRef);
    }
  };
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
  const { closing, paper, live } = settling;
  const after: ReceiptAfter | undefined =
    paper === undefined ? live?.outcome : { kind: "paper", fill: paper.fill };
  const assets = { ...live?.assets, ...paper?.assets };
  const html = receiptHtml(closing, context.displayOf(assets), after);
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
  if (standing.status === "locked") {
    return context.words("error.engine.locked");
  }
  if (standing.status === "over_cap") {
    return context.words("error.limit.daily_cap");
  }
  return standing.status === "open" && standing.reason !== undefined
    ? context.words(`reason.${standing.reason}`)
    : undefined;
}

// The answer is stored by now; a press Telegram no longer takes an answer for only spins on.
async function answerPress(context: CardsContext, pressed: Pressed, call: Call): Promise<void> {
  try {
    const notice = noticeOf(context, pressed.standing);
    await context.bot.answer(pressed.press.callbackId, notice, call);
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
    const { closing, paper } = standing;
    await settle(context, { ref, closing, ...(paper === undefined ? {} : { paper }), ...at }, call);
  }
}

/**
 * Creates the owner's confirmation cards in Telegram (spec 4, sections 2 and 3). Every value from
 * outside is escaped, buttons carry `bnf1:c:<decision>:<ref>` data, the engine checks the presser
 * and stores the answer before Telegram hears back, and the first answer, from any surface, turns
 * every copy into its receipt.
 */
export function createTelegramCards(options: TelegramCardsOptions): TelegramCards {
  const formatters = createOwnerFormatters();
  const formatter = () => formatters(options.display());
  const context: CardsContext = {
    options,
    calls: createCardCalls(options.api),
    bot: createBotCalls(options.api),
    // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
    words: (key) => formatter().message(key),
    displayOf: (assets) => ({ formatter: formatter(), assets }),
  };
  return {
    show: oneShowAtATime(context),
    offerCancel: async (showing, call) => send(context, { showing, decisions: ["deny"] }, call),
    settle: async (settling, call) => settle(context, settling, call),
    press: async (pressed, call) => press(context, pressed, call),
  };
}
