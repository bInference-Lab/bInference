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
const stream = () => ({ stream: "partial" }) as const;

// The replies in the partial reply mode, on the synthetic Bot API.
async function setUp(locale: MessageLocale = "en") {
  const botApi = createFakeBotApi();
  const clock = createManualClock(1_760_000_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  createBotThrottlers({ clock, logger }).install(api);
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const display = () => ({ locale, timeZone: "UTC" }) as const;
  const replies = createChatReplies({ api, owners, clock, logger, display, replies: stream });
  return { botApi, clock, replies };
}

function push(kind: string, data: JsonValue) {
  return { kind, data };
}

const started = push("chat/turnStarted", at);
const ended = push("chat/turnEnded", { agent, turn, outcome: "ok" });
const answer = (text: string, final = true) => push("chat/message", { ...at, text, final });
const tool = push("chat/progress", { agent, turn, progressKey: "turn.tool.quote" });
const thirty = "The price of BNB is up today, ";

// Shows a final answer, moving time so the chat's pace lets each call go.
async function finish(test: Awaited<ReturnType<typeof setUp>>, text: string): Promise<void> {
  const shown = test.replies.show(answer(text), live);
  await test.clock.advance(5_000);
  await shown;
  await test.replies.show(ended, live);
  await test.clock.advance(10_000);
  await test.replies.idle();
}

describe("the partial reply mode in Telegram", () => {
  it("grows the answer in one message, first sent at 30 characters, edited once a second", async () => {
    const test = await setUp();
    await test.replies.show(started, live);
    await test.replies.show(answer("The price of BNB", false), live);
    await test.clock.advance(2_000);
    expect(test.botApi.sent()).toStrictEqual([]);
    await test.replies.show(answer(`${thirty}by 2%`, false), live);
    await test.clock.advance(0);
    await test.replies.idle();
    await test.replies.show(answer(`${thirty}by 2% in a day.`, false), live);
    await test.clock.advance(900);
    expect(test.botApi.edits()).toStrictEqual([]);
    await test.clock.advance(100);
    await test.replies.idle();
    expect(test.botApi.sent().map(({ text }) => text)).toStrictEqual([`${thirty}by 2%`]);
    expect(test.botApi.messages().map(({ text }) => text)).toStrictEqual([
      `${thirty}by 2% in a day.`,
    ]);
  });

  it("edits the preview into the final answer in place, with no new message", async () => {
    const test = await setUp();
    await test.replies.show(started, live);
    await test.replies.show(answer(`${thirty}by 2%`, false), live);
    await test.clock.advance(0);
    await test.replies.idle();
    await finish(test, `${thirty}by **2%** in a day.`);
    expect(test.botApi.sent()).toHaveLength(1);
    expect(test.botApi.messages()).toMatchObject([
      { text: `${thirty}by 2% in a day.`, entities: [{ type: "bold" }] },
    ]);
    expect(test.botApi.deleted()).toStrictEqual([]);
  });

  it("keeps the preview as the first page of a long answer and sends the rest", async () => {
    const test = await setUp();
    await test.replies.show(started, live);
    const long = `${"a".repeat(3_000)}\n\n${"b".repeat(3_000)}`;
    await test.replies.show(answer(long.slice(0, 3_500), false), live);
    await test.clock.advance(0);
    await test.replies.idle();
    await finish(test, long);
    expect(test.botApi.messages().map(({ text }) => text)).toStrictEqual([
      "a".repeat(3_000),
      "b".repeat(3_000),
    ]);
    expect(test.botApi.sent()).toHaveLength(2);
  });

  it("sends the answer as a new message when the final edit fails, and deletes the preview", async () => {
    const test = await setUp();
    await test.replies.show(started, live);
    await test.replies.show(answer(`${thirty}by 2%`, false), live);
    await test.clock.advance(0);
    await test.replies.idle();
    test.botApi.failNext("editMessageText", { status: 400, description: "Bad Request: no rights" });
    await finish(test, `${thirty}by 2% in a day.`);
    expect(test.botApi.messages().map(({ text }) => text)).toStrictEqual([
      `${thirty}by 2% in a day.`,
    ]);
    expect(test.botApi.deleted()).toStrictEqual([{ chatId: ownerId, messageId: 1001 }]);
  });

  it("sends an answer that never reached 30 characters as a new message", async () => {
    const test = await setUp();
    await test.replies.show(started, live);
    await test.replies.show(answer("Hey!", false), live);
    await finish(test, "Hey! How can I help?");
    expect(test.botApi.sent().map(({ text }) => text)).toStrictEqual(["Hey! How can I help?"]);
    expect(test.botApi.edits()).toStrictEqual([]);
  });

  it("shows the label while a tool runs, then the answer as it grows, then the final", async () => {
    const test = await setUp();
    await test.replies.show(started, live);
    await test.replies.show(tool, live);
    await test.clock.advance(0);
    await test.replies.idle();
    expect(test.botApi.messages().map(({ text }) => text)).toStrictEqual(["Working"]);
    await test.replies.show(answer("BNB", false), live);
    await test.clock.advance(1_000);
    await test.replies.idle();
    expect(test.botApi.messages().map(({ text }) => text)).toStrictEqual(["BNB"]);
    await finish(test, "BNB is at $600.");
    expect(test.botApi.messages().map(({ text }) => text)).toStrictEqual(["BNB is at $600."]);
    expect(test.botApi.sent()).toHaveLength(1);
  });
});
