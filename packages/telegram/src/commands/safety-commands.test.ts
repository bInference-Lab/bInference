import { err, ok } from "@binference/core";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import { describe, expect, it } from "vitest";
import { cardIntent } from "../testing/card-fixtures.js";
import { ownerId } from "../testing/update-fixtures.js";
import { startCommandBot, waitingSwap } from "./test-command-bot.js";

const ref = waitingSwap.callbackRef;
const icons = { confirm: String.fromCodePoint(0x2705), cancel: String.fromCodePoint(0x274c) };
const both = [
  { text: `${icons.confirm} Confirm`, data: `bnf1:c:y:${ref}` },
  { text: `${icons.cancel} Cancel`, data: `bnf1:c:n:${ref}` },
];
const waitingText =
  "The rescue card waits for your tap. Check the rescue address on it, then tap Confirm.";

function rescuing(rescue: Awaited<ReturnType<NonNullable<OwnerChatHandlers["safety/rescue"]>>>) {
  return {
    "safety/rescue": async () => Promise.resolve(rescue),
    "safety/status": async () =>
      Promise.resolve(ok({ frozen: true, rescue: { intent: cardIntent, state: "executing" } })),
  } satisfies OwnerChatHandlers;
}

describe("the rescue from Telegram", () => {
  it("shows the rescue card with its buttons and answers under it", async () => {
    const bot = await startCommandBot(rescuing(ok({ intent: cardIntent })), {
      waiting: [waitingSwap],
    });
    await bot.send("/rescue");
    const [card] = bot.botApi.messages();
    expect(card?.buttons).toStrictEqual([both]);
    expect(bot.botApi.sent()[1]).toStrictEqual({
      chatId: ownerId,
      text: waitingText,
      replyTo: card?.messageId,
    });
  });

  it("shows a rescue card once, and answers a second /rescue under the same card", async () => {
    const bot = await startCommandBot(rescuing(ok({ intent: cardIntent })), {
      waiting: [waitingSwap],
    });
    await bot.send("/rescue");
    await bot.send("/rescue");
    const cards = bot.botApi.messages().filter((message) => message.buttons.length > 0);
    expect(cards).toHaveLength(1);
    expect(bot.botApi.sent().filter((sent) => sent.text === waitingText)).toStrictEqual([
      { chatId: ownerId, text: waitingText, replyTo: cards[0]?.messageId },
      { chatId: ownerId, text: waitingText, replyTo: cards[0]?.messageId },
    ]);
  });

  it("says how far a rescue past its card got, or that it ended", async () => {
    const underWay = await startCommandBot(rescuing(ok({ intent: cardIntent })));
    await underWay.send("/rescue");
    const ended = await startCommandBot({
      ...rescuing(ok({ intent: cardIntent })),
      "safety/status": async () => Promise.resolve(ok({ frozen: true })),
    });
    await ended.send("/rescue");
    expect([...underWay.texts(), ...ended.texts()]).toStrictEqual([
      "A rescue is under way: sending.",
      "The rescue ended. Use /rescue again to move what is left.",
    ]);
  });

  it("answers why no rescue opens, such as no rescue address", async () => {
    const bot = await startCommandBot(rescuing(err("rescue.no_address")));
    await bot.send("/rescue");
    expect(bot.texts()).toStrictEqual([
      "Set a rescue address first: run `binference rescue set` with your own wallet's address.",
    ]);
  });
});

describe("the cancel from Telegram", () => {
  it("sends each waiting card again with its Cancel button alone", async () => {
    const bot = await startCommandBot({}, { waiting: [waitingSwap] });
    await bot.send("/cancel");
    expect(bot.texts()[0]).toBe(
      "1 action waits for your confirmation. Tap Cancel on it to stop it.",
    );
    expect(bot.botApi.messages()[1]?.buttons).toStrictEqual([
      [{ text: `${icons.cancel} Cancel`, data: `bnf1:c:n:${ref}` }],
    ]);
  });

  it("cancels the card on a tap, and turns every copy into the receipt", async () => {
    const bot = await startCommandBot(rescuing(ok({ intent: cardIntent })), {
      waiting: [waitingSwap],
    });
    bot.answers.open(ref);
    await bot.send("/rescue");
    await bot.send("/cancel");
    const copies = bot.botApi.messages().filter((message) => message.buttons.length > 0);
    expect(copies).toHaveLength(2);
    const [, cancelCopy] = copies.map((copy) => copy.messageId);
    const press = { from: ownerId, data: `bnf1:c:n:${ref}`, messageId: cancelCopy as number };
    await bot.receive(bot.botApi.press(press));
    const receipts = bot.botApi
      .messages()
      .filter((message) => copies.some((copy) => copy.messageId === message.messageId));
    expect(receipts.map((receipt) => [receipt.text, receipt.buttons])).toStrictEqual([
      [`${icons.cancel} Cancelled on Telegram`, []],
      [`${icons.cancel} Cancelled on Telegram`, []],
    ]);
  });

  it("says nothing waits when no card is open", async () => {
    const bot = await startCommandBot({});
    await bot.send("/cancel");
    expect(bot.texts()).toStrictEqual([
      "Nothing waits for your confirmation, so there is nothing to cancel.",
    ]);
  });
});
