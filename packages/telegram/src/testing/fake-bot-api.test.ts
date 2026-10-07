import { Api, GrammyError } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeBotApi, fakeBotToken } from "./fake-bot-api.js";
import { ownerId, strangerId } from "./update-fixtures.js";

const keyboard = { inline_keyboard: [[{ text: "Yes", callback_data: "bnf1:c:y:abc" }]] };

function setUp() {
  const botApi = createFakeBotApi();
  return { botApi, api: new Api(fakeBotToken, { fetch: botApi.fetch }) };
}

async function refusalOf(call: Promise<unknown>): Promise<GrammyError> {
  const caught: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(GrammyError);
  return caught as GrammyError;
}

describe("the fake Bot API", () => {
  it("shows an HTML message with its buttons the way a reader sees it", async () => {
    const { botApi, api } = setUp();
    const sent = await api.sendMessage(ownerId, "<b>Card</b> for &lt;b&gt;", {
      parse_mode: "HTML",
      reply_markup: keyboard,
      message_thread_id: 3,
    });
    expect(sent.message_id).toBe(1001);
    expect(botApi.messages()).toStrictEqual([
      {
        chatId: ownerId,
        messageId: 1001,
        threadId: 3,
        text: "Card for <b>",
        entities: [{ type: "bold", offset: 0, length: 4 }],
        buttons: [[{ text: "Yes", data: "bnf1:c:y:abc" }]],
      },
    ]);
    expect(botApi.sent()).toStrictEqual([{ chatId: ownerId, text: "Card for <b>", threadId: 3 }]);
  });

  it.each([
    {
      name: "HTML Telegram cannot parse",
      text: "Sell <b> now",
      description: "can't parse entities",
    },
    {
      name: "a parse mode it does not know",
      text: "*x*",
      other: { parse_mode: "Markdown" as const },
      description: "unsupported parse_mode",
    },
    { name: "an empty text", text: "<b></b>", description: "message text is empty" },
    { name: "a long text", text: "x".repeat(4097), description: "message is too long" },
    {
      name: "callback data over 64 bytes",
      text: "x",
      other: {
        reply_markup: { inline_keyboard: [[{ text: "Yes", callback_data: "y".repeat(65) }]] },
      },
      description: "BUTTON_DATA_INVALID",
    },
  ])("refuses $name with a 400 and keeps nothing", async ({ text, other, description }) => {
    const { botApi, api } = setUp();
    const fault = await refusalOf(api.sendMessage(ownerId, text, { parse_mode: "HTML", ...other }));
    expect(fault.error_code).toBe(400);
    expect(fault.description).toContain(description);
    expect([botApi.messages(), botApi.sent()]).toStrictEqual([[], []]);
  });

  it("refuses parameters in a shape the Bot API does not take", async () => {
    const { api } = setUp();
    const fault = await refusalOf(api.raw.sendMessage({ chat_id: "@channel", text: "x" }));
    expect(fault.description).toBe("Bad Request: wrong parameters");
  });

  it("edits a card into its receipt and removes the buttons", async () => {
    const { botApi, api } = setUp();
    const sent = await api.sendMessage(ownerId, "Card", { reply_markup: keyboard });
    await api.editMessageText(ownerId, sent.message_id, "<i>Receipt</i>", { parse_mode: "HTML" });
    expect(botApi.messages()).toStrictEqual([
      {
        chatId: ownerId,
        messageId: sent.message_id,
        text: "Receipt",
        entities: [{ type: "italic", offset: 0, length: 7 }],
        buttons: [],
      },
    ]);
    expect(botApi.edits()).toStrictEqual([
      { method: "editMessageText", chatId: ownerId, messageId: sent.message_id },
    ]);
  });

  it("removes a message's buttons and keeps its text", async () => {
    const { botApi, api } = setUp();
    const sent = await api.sendMessage(ownerId, "Card", { reply_markup: keyboard });
    await api.editMessageReplyMarkup(ownerId, sent.message_id);
    expect(botApi.messages()).toMatchObject([{ text: "Card", buttons: [] }]);
    const again = await refusalOf(api.editMessageReplyMarkup(ownerId, sent.message_id));
    expect(again.description).toBe("Bad Request: message is not modified");
  });

  it("refuses an edit that changes nothing and one of a message it does not have", async () => {
    const { botApi, api } = setUp();
    const sent = await api.sendMessage(ownerId, "Card");
    const same = await refusalOf(api.editMessageText(ownerId, sent.message_id, "Card"));
    const missing = await refusalOf(api.editMessageText(ownerId, 4242, "Receipt"));
    const elsewhere = await refusalOf(api.editMessageReplyMarkup(strangerId, sent.message_id));
    expect([same.description, missing.description, elsewhere.description]).toStrictEqual([
      "Bad Request: message is not modified",
      "Bad Request: message to edit not found",
      "Bad Request: message to edit not found",
    ]);
    expect(botApi.edits()).toStrictEqual([]);
  });

  it("presses a button as an update and takes one answer for it", async () => {
    const { botApi, api } = setUp();
    const update = botApi.press({ from: ownerId, data: "bnf1:c:y:abc", messageId: 1001 });
    expect(update).toStrictEqual({
      update_id: 9001,
      callback_query: {
        id: "press-9001",
        from: { id: ownerId, is_bot: false, first_name: "Fixture" },
        chat_instance: "1",
        data: "bnf1:c:y:abc",
        message: { message_id: 1001, date: 1, chat: { id: ownerId, type: "private" } },
      },
    });
    expect(botApi.pending()).toStrictEqual([9001]);
    await api.answerCallbackQuery("press-9001", { text: "Done" });
    const twice = await refusalOf(api.answerCallbackQuery("press-9001"));
    expect(twice.description).toContain("query is too old");
    expect(botApi.answers()).toStrictEqual([{ callbackId: "press-9001", text: "Done" }]);
  });

  it("presses as another person, in another chat, in their language", () => {
    const { botApi } = setUp();
    const update = botApi.press({
      from: strangerId,
      data: "forged",
      messageId: 7,
      chatId: -100,
      chatType: "supergroup",
      isBot: true,
      languageCode: "zh-hans",
    });
    expect(update).toMatchObject({
      callback_query: {
        from: { id: strangerId, is_bot: true, language_code: "zh-hans" },
        message: { chat: { id: -100, type: "supergroup" } },
      },
    });
  });

  it("deletes a message the bot sent", async () => {
    const { botApi, api } = setUp();
    const sent = await api.sendMessage(ownerId, "Card");
    await api.deleteMessage(ownerId, sent.message_id);
    expect(botApi.messages()).toStrictEqual([]);
    expect(botApi.deleted()).toStrictEqual([{ chatId: ownerId, messageId: sent.message_id }]);
  });

  it("fails the next call to one chat only, and logs every call in order", async () => {
    const { botApi, api } = setUp();
    botApi.failNext(
      "sendMessage",
      { status: 429, description: "Too Many", retryAfterS: 3 },
      {
        chatId: strangerId,
      },
    );
    await api.sendMessage(ownerId, "first");
    const flood = await refusalOf(api.sendMessage(strangerId, "second"));
    await api.sendMessage(strangerId, "third");
    expect(flood).toMatchObject({ error_code: 429, parameters: { retry_after: 3 } });
    expect(botApi.sent().map((sent) => sent.text)).toStrictEqual(["first", "third"]);
    expect(botApi.calls()).toStrictEqual([
      { method: "sendMessage", chatId: ownerId },
      { method: "sendMessage", chatId: strangerId },
      { method: "sendMessage", chatId: strangerId },
    ]);
  });

  it("answers a method it does not know with 404", async () => {
    const { api } = setUp();
    const fault = await refusalOf(api.getChat(ownerId));
    expect(fault.error_code).toBe(404);
  });
});
