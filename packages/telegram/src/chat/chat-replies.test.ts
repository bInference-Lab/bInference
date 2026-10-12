import type { JsonValue } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { createMemoryOwnerStore } from "@binference/engine/testing";
import type { MessageLocale } from "@binference/i18n";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createBotThrottlers } from "../throttle/create-bot-throttlers.js";
import { createChatReplies } from "./chat-replies.js";

const live = { signal: new AbortController().signal };
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const at = { agent, session: "ses_0190f1c2-3a4b-7c5d-8e6f-0123456789ab", turn };

async function setUp(options: { readonly locale?: MessageLocale; readonly isPaired?: false } = {}) {
  const botApi = createFakeBotApi();
  const clock = createManualClock(1_760_000_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  createBotThrottlers({ clock, logger }).install(api);
  const owners = createMemoryOwnerStore();
  if (options.isPaired !== false) {
    await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  }
  const display = () => ({ locale: options.locale ?? "en", timeZone: "UTC" }) as const;
  const replies = createChatReplies({ api, owners, clock, logger, display });
  return { botApi, clock, logger, replies };
}

function push(kind: string, data: JsonValue) {
  return { kind, data };
}

const started = push("chat/turnStarted", at);
const ended = push("chat/turnEnded", { agent, turn, outcome: "ok" });
const answer = (text: string, final = true) => push("chat/message", { ...at, text, final });
const flood = (retryAfterS: number) => ({
  status: 429,
  description: "Too Many Requests",
  retryAfterS,
});

describe("the agent's replies in Telegram", () => {
  it("shows one status message edited once a second, then the answer as a new message", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    await clock.advance(1_000);
    await replies.idle();
    const shown = replies.show(answer("Bought 0.1 BNB of FAKE on paper."), live);
    await clock.advance(2_000);
    await shown;
    await replies.show(ended, live);
    expect(botApi.sent().map(({ text }) => text)).toStrictEqual([
      "Working on it · 0 s",
      "Bought 0.1 BNB of FAKE on paper.",
    ]);
    expect(botApi.edits()).toStrictEqual([
      { method: "editMessageText", chatId: ownerId, messageId: 1001 },
    ]);
    expect(botApi.deleted()).toStrictEqual([{ chatId: ownerId, messageId: 1001 }]);
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual([
      "Bought 0.1 BNB of FAKE on paper.",
    ]);
  });

  it("shows the agent's text so far in the status message while it writes", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    await replies.show(answer("Checking the token's risk", false), live);
    await clock.advance(1_000);
    await replies.idle();
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual(["Checking the token's risk"]);
  });

  it("drops a preview Telegram answers with a 429, and still delivers the answer", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    botApi.failNext("editMessageText", flood(3), { chatId: ownerId });
    botApi.failNext("sendMessage", flood(2), { chatId: ownerId });
    await clock.advance(1_000);
    await replies.idle();
    const shown = replies.show(answer("Done."), live);
    await clock.advance(6_000);
    await shown;
    const methods = botApi.calls().map(({ method }) => method);
    expect(methods).toStrictEqual([
      "sendMessage",
      "editMessageText",
      "sendMessage",
      "sendMessage",
      "deleteMessage",
    ]);
    expect(botApi.edits()).toStrictEqual([]);
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual(["Done."]);
  });

  it("shows model text holding markup and hidden characters as text", async () => {
    const { botApi, replies } = await setUp();
    const text = `Use <b>bold</b> & <a href="x">this</a>\nnext line ${String.fromCodePoint(0x202e)}`;
    await replies.show(answer(text), live);
    expect(botApi.messages()).toMatchObject([
      {
        text: 'Use <b>bold</b> & <a href="x">this</a>\nnext line \\u{202E}',
        entities: [],
      },
    ]);
  });

  it("splits a long answer at line breaks into messages of 4,096 characters at most", async () => {
    const { botApi, clock, replies } = await setUp();
    const line = "x".repeat(99);
    const shown = replies.show(answer(Array.from({ length: 60 }, () => line).join("\n")), live);
    await clock.advance(1_000);
    await shown;
    expect(botApi.sent().map(({ text }) => text.length)).toStrictEqual([3_999, 1_999]);
  });

  it("shows a status line in italics after the answer", async () => {
    const { botApi, clock, replies } = await setUp();
    const line = push("chat/status", {
      agent,
      turn,
      statusKey: "turn.moreProposals",
      values: { count: 2 },
    });
    const shown = replies.show(line, live);
    await clock.advance(0);
    await shown;
    expect(botApi.messages()).toMatchObject([
      {
        text: "2 more proposals follow once you answer this card",
        entities: [{ type: "italic", offset: 0, length: 49 }],
      },
    ]);
  });

  it("deletes the status message of a turn that ends without an answer", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show(started, live);
    const shown = replies.show(ended, live);
    await clock.advance(1_000);
    await shown;
    expect(botApi.messages()).toStrictEqual([]);
    expect(botApi.edits()).toStrictEqual([]);
  });

  it("sends nothing before the owner pairs, and reads no other push", async () => {
    const { botApi, replies } = await setUp({ isPaired: false });
    await replies.show(started, live);
    await replies.show(answer("hello"), live);
    await replies.show(push("intent/changed", { intent: "x" }), live);
    expect(botApi.calls()).toStrictEqual([]);
  });
});
