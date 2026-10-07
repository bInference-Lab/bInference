import type { JsonValue } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { type CardFacts, checkReasons, drawCard } from "@binference/engine";
import type { PaperReceipt } from "@binference/engine/surfaces";
import { createMemoryAccessStore, createMemoryInboxStore } from "@binference/engine/testing";
import { messages } from "@binference/i18n";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeCardAnswers } from "../fakes/fake-card-answers.js";
import { createMemoryCardCopyStore } from "../fakes/memory-card-copy-store.js";
import { createMemoryOwnerStore } from "../fakes/memory-owner-store.js";
import { createTelegramIngress } from "../ingress/create-telegram-ingress.js";
import type { CardAnswers } from "../ports.js";
import {
  assetsWith,
  cardExpiresAtMs,
  cardIntent,
  pepeBuyFacts,
  refs,
  swapFacts,
} from "../testing/card-fixtures.js";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId, strangerId } from "../testing/update-fixtures.js";
import { createBotThrottlers } from "../throttle/create-bot-throttlers.js";
import { type ButtonPress, chatUpdateSchema } from "../updates/chat-update.schema.js";
import { createTelegramCards } from "./create-telegram-cards.js";

const live = { signal: new AbortController().signal };
const ref = "q3Zr_x9-AbCdEfGh";
const nextRef = "Zz9_Yy8-XxWwVvUu";
const icons = { done: String.fromCodePoint(0x2705), refused: String.fromCodePoint(0x274c) };
const confirmData = `bnf1:c:y:${ref}`;
const buttons = [
  [
    { text: `${icons.done} Confirm`, data: confirmData },
    { text: `${icons.refused} Cancel`, data: `bnf1:c:n:${ref}` },
  ],
];

async function setUp(options: { readonly isPaired?: boolean; readonly throttled?: true } = {}) {
  const botApi = createFakeBotApi();
  const clock = createManualClock(cardExpiresAtMs - 30_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  if (options.throttled === true) {
    createBotThrottlers({ clock, logger }).install(api);
  }
  const owners = createMemoryOwnerStore();
  if (options.isPaired !== false) {
    await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  }
  const copies = createMemoryCardCopyStore();
  const engine = createFakeCardAnswers({ clock, ownerId });
  // The Bot API's answers when the engine has stored an answer: none may come before it.
  const answersAtStore: number[] = [];
  const answers: CardAnswers = {
    answer: async (press, call) => {
      const standing = await engine.answer(press, call);
      answersAtStore.push(botApi.answers().length);
      return standing;
    },
  };
  const display = { locale: "en", timeZone: "UTC" } as const;
  const cards = createTelegramCards({ api, owners, copies, answers, logger, display });
  const ingress = createTelegramIngress({
    api,
    stores: { inbox: createMemoryInboxStore(), access: createMemoryAccessStore(), owners },
    clock,
    logger,
    display,
    onOwnerUpdate: async (update, call) =>
      update.kind === "callback" ? cards.press(update, call) : Promise.resolve(),
  });
  return { botApi, clock, logger, api, copies, engine, answersAtStore, cards, ingress };
}

function showing(facts: CardFacts = swapFacts, callbackRef = ref, assets = assetsWith()) {
  return { intent: cardIntent, card: drawCard(facts), callbackRef, assets, threadId: 4 };
}

function pressOf(update: JsonValue): ButtonPress {
  const parsed = chatUpdateSchema.parse(update);
  if (parsed.kind !== "callback") {
    throw new Error("The fixture is no button press.");
  }
  return parsed;
}

type Context = Awaited<ReturnType<typeof setUp>>;

// The engine's side of a press as it answers for a paper intent: a closed card shows the fill.
function withPaperFill(answers: CardAnswers, paper: PaperReceipt): CardAnswers {
  return {
    answer: async (press, call) => {
      const standing = await answers.answer(press, call);
      return standing.status === "closed" ? { ...standing, paper } : standing;
    },
  };
}

async function pressCard(context: Context, data: string, from = ownerId): Promise<void> {
  const update = context.botApi.press({ from, data, messageId: 1001 });
  await context.cards.press(pressOf(update), live);
}

describe("the Telegram cards", () => {
  it("show a card in the owner's chat with Confirm and Cancel, and keep the copy", async () => {
    const context = await setUp();
    context.engine.open(ref);
    const shown = await context.cards.show(showing(), live);
    const copy = { ref, intent: cardIntent, cardVersion: 1, chatId: ownerId, messageId: 1001 };
    expect(shown).toStrictEqual({ ok: true, value: copy });
    expect(context.botApi.messages()).toMatchObject([
      { chatId: ownerId, messageId: 1001, threadId: 4, entities: [], buttons },
    ]);
    expect(context.botApi.messages()[0]?.text.split("\n")[1]).toBe(
      "Sell 0.5 BNB → at least 312.4 USDT",
    );
    expect(await context.copies.find(ref, live)).toStrictEqual([copy]);
    expect(context.logger.records()).toMatchObject([
      { level: "info", event: "telegram.card_shown", fields: { intentId: cardIntent } },
    ]);
  });

  it("show a token named <b> as text, never as bold", async () => {
    const context = await setUp();
    await context.cards.show(showing(pepeBuyFacts, ref, assetsWith({ symbol: "<b>" })), live);
    const [message] = context.botApi.messages();
    expect(message?.entities).toStrictEqual([]);
    expect(message?.text).toContain("at least 1,000,000 <b> (0x6982…1933)");
  });

  it("show each card version once", async () => {
    const context = await setUp();
    const first = await context.cards.show(showing(), live);
    const again = await context.cards.show(showing(), live);
    expect(again).toStrictEqual(first);
    expect(context.botApi.sent()).toHaveLength(1);
  });

  it("take the buttons off earlier versions when a new version is shown", async () => {
    const context = await setUp();
    await context.cards.show(showing(), live);
    const requoted = { ...swapFacts, card: { ...swapFacts.card, version: 2 } };
    await context.cards.show(showing(requoted, nextRef), live);
    expect(context.botApi.messages().map((message) => message.buttons.length)).toStrictEqual([
      0, 1,
    ]);
  });

  it("show nothing before an owner is bound", async () => {
    const context = await setUp({ isPaired: false });
    expect(await context.cards.show(showing(), live)).toStrictEqual({
      ok: false,
      error: "no_owner",
    });
    expect(context.botApi.calls()).toStrictEqual([]);
  });

  it("store the owner's answer before Telegram hears back, then become the receipt", async () => {
    const context = await setUp();
    context.engine.open(ref);
    await context.cards.show(showing(), live);
    await pressCard(context, confirmData);
    expect(context.answersAtStore).toStrictEqual([0]);
    expect(context.botApi.answers()).toStrictEqual([{ callbackId: "press-9001" }]);
    expect(context.botApi.messages()).toMatchObject([
      { text: `${icons.done} Confirmed on Telegram at 14:31:35 · sending`, buttons: [] },
    ]);
    expect(context.botApi.calls().map((call) => call.method)).toStrictEqual([
      "sendMessage",
      "answerCallbackQuery",
      "editMessageText",
    ]);
  });

  it("become the receipt of a Cancel", async () => {
    const context = await setUp();
    context.engine.open(ref);
    await context.cards.show(showing(), live);
    await pressCard(context, `bnf1:c:n:${ref}`);
    expect(context.botApi.messages()).toMatchObject([
      { text: `${icons.refused} Cancelled on Telegram`, buttons: [] },
    ]);
  });

  it.each([
    ["data no card button carries", "hello", ownerId],
    ["a decision no button has", `bnf1:c:x:${ref}`, ownerId],
    ["a Details press, which no card draws yet", `bnf1:c:d:${ref}`, ownerId],
    ["a reference no card has", "bnf1:c:y:ZZZZZZZZZZZZZZZZ", ownerId],
    ["the real button pressed by someone else", confirmData, strangerId],
  ])("do nothing for a forged press: %s", async (_name, data, from) => {
    const context = await setUp();
    context.engine.open(ref);
    await context.cards.show(showing(), live);
    await pressCard(context, data, from);
    expect(context.engine.answered()).toStrictEqual([]);
    expect(context.botApi.answers()).toStrictEqual([]);
    expect(context.botApi.edits()).toStrictEqual([]);
    expect(context.botApi.messages()).toMatchObject([{ buttons }]);
  });

  it("hear only the owner's presses in the owner's chat, through the ingress", async () => {
    const context = await setUp();
    context.engine.open(ref);
    await context.cards.show(showing(), live);
    const { botApi, ingress } = context;
    await ingress.receive(
      botApi.press({ from: strangerId, data: confirmData, messageId: 1001 }),
      live,
    );
    const inGroup = { from: ownerId, data: confirmData, messageId: 1001, chatId: -100 };
    await ingress.receive(botApi.press({ ...inGroup, chatType: "supergroup" }), live);
    expect([context.engine.answered(), botApi.answers(), botApi.edits()]).toStrictEqual([
      [],
      [],
      [],
    ]);
    await ingress.receive(
      botApi.press({ from: ownerId, data: confirmData, messageId: 1001 }),
      live,
    );
    expect(context.engine.answered()).toStrictEqual([
      { ref, decision: "confirm", presserId: ownerId },
    ]);
    expect(botApi.messages()).toMatchObject([{ buttons: [] }]);
  });

  it("keep the card open and say why when the re-quote fails", async () => {
    const context = await setUp();
    context.engine.open(ref);
    context.engine.refuseNext(ref, "no_route");
    await context.cards.show(showing(), live);
    await pressCard(context, confirmData);
    expect(context.botApi.answers()).toStrictEqual([
      { callbackId: "press-9001", text: "no route was found for this trade" },
    ]);
    expect(context.botApi.messages()).toMatchObject([{ buttons }]);
  });

  it.each(checkReasons)("say why a card stays open after a %s re-quote", async (reason) => {
    const context = await setUp();
    context.engine.open(ref);
    context.engine.refuseNext(ref, reason);
    await pressCard(context, confirmData);
    expect(context.botApi.answers()).toStrictEqual([
      { callbackId: "press-9001", text: messages.en[`reason.${reason}`] },
    ]);
  });

  it("turn every copy into the receipt when another surface answers first", async () => {
    const context = await setUp();
    await context.cards.show(showing(), live);
    const closing = {
      outcome: "denied",
      answeredBy: { surface: "console", by: "dev_1" },
      atMs: cardExpiresAtMs - 20_000,
    } as const;
    context.engine.close(ref, closing);
    await context.cards.settle({ ref, closing }, live);
    await pressCard(context, confirmData);
    expect(context.botApi.messages()).toMatchObject([
      { text: `${icons.refused} Cancelled on the console`, buttons: [] },
    ]);
    expect(context.botApi.edits()).toHaveLength(1);
    expect(context.botApi.answers()).toStrictEqual([{ callbackId: "press-9001" }]);
  });

  it("turn the pressed card into the receipt of its paper fill", async () => {
    const context = await setUp();
    context.engine.open(ref);
    const fill = {
      amountIn: { asset: refs.bnb, base: 5n * 10n ** 17n },
      amountOut: { asset: refs.usdt, base: 31_395n * 10n ** 16n },
    };
    const filling = withPaperFill(context.engine, { fill, assets: assetsWith() });
    const { api, copies, logger, botApi } = context;
    const display = { locale: "en", timeZone: "UTC" } as const;
    const owners = createMemoryOwnerStore();
    await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
    const cards = createTelegramCards({ api, owners, copies, answers: filling, logger, display });
    await cards.show(showing(), live);
    const update = botApi.press({ from: ownerId, data: confirmData, messageId: 1001 });
    await cards.press(pressOf(update), live);
    const icon = String.fromCodePoint(0x1f9ea);
    expect(botApi.messages()).toMatchObject([
      { text: `${icon} Paper fill: 0.5 BNB → 313.95 USDT`, buttons: [] },
    ]);
  });

  it("turn every copy into the paper fill's receipt when another surface confirms", async () => {
    const context = await setUp();
    await context.cards.show(showing(), live);
    const closing = {
      outcome: "confirmed",
      answeredBy: { surface: "cli", by: "tok_1" },
      atMs: cardExpiresAtMs - 20_000,
    } as const;
    const fill = {
      amountIn: { asset: refs.bnb, base: 5n * 10n ** 17n },
      amountOut: { asset: refs.usdt, base: 31_395n * 10n ** 16n },
    };
    await context.cards.settle({ ref, closing, paper: { fill, assets: assetsWith() } }, live);
    expect(context.botApi.messages()).toMatchObject([
      { text: `${String.fromCodePoint(0x1f9ea)} Paper fill: 0.5 BNB → 313.95 USDT`, buttons: [] },
    ]);
  });

  it("turn the card into its receipt when it expires", async () => {
    const context = await setUp();
    await context.cards.show(showing(), live);
    await context.cards.settle(
      { ref, closing: { outcome: "expired", atMs: cardExpiresAtMs } },
      live,
    );
    expect(context.botApi.messages()).toMatchObject([
      { text: `${icons.refused} Expired with no answer`, buttons: [] },
    ]);
  });

  it("turn the pressed message into the receipt when no copy of it was kept", async () => {
    const context = await setUp();
    context.engine.open(ref);
    await context.api.sendMessage(ownerId, "a card shown before a restart");
    await pressCard(context, confirmData);
    expect(context.botApi.messages()).toMatchObject([
      { messageId: 1001, text: `${icons.done} Confirmed on Telegram at 14:31:35 · sending` },
    ]);
  });

  it("log a press Telegram takes no answer for, and still become the receipt", async () => {
    const context = await setUp();
    context.engine.open(ref);
    await context.cards.show(showing(), live);
    context.botApi.failNext("answerCallbackQuery", {
      status: 400,
      description: "query is too old",
    });
    await pressCard(context, confirmData);
    expect(context.logger.records()).toContainEqual({
      level: "warn",
      subsystem: "telegram",
      event: "telegram.press_answer_failed",
      fields: { errorCode: "telegram.api_refused" },
    });
    expect(context.botApi.messages()).toMatchObject([{ buttons: [] }]);
  });

  it("wait out a 429 in the throttler only: the card goes out once, with no fault", async () => {
    const context = await setUp({ throttled: true });
    context.botApi.failNext(
      "sendMessage",
      { status: 429, description: "Too Many Requests", retryAfterS: 2 },
      { chatId: ownerId },
    );
    const shown = context.cards.show(showing(), live);
    await context.clock.advance(2_000);
    expect(await shown).toMatchObject({ ok: true, value: { messageId: 1001 } });
    expect(context.botApi.sent()).toHaveLength(1);
    expect(context.botApi.calls().map((call) => call.method)).toStrictEqual([
      "sendMessage",
      "sendMessage",
    ]);
  });
});
