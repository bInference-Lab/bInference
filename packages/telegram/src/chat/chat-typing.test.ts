import type { JsonValue } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { createMemoryOwnerStore } from "@binference/engine/testing";
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
const startMs = 1_760_000_000_000;
const display = () => ({ locale: "en", timeZone: "UTC" }) as const;

// The replies on a fake Bot API that notes when each call arrived, in ms from the start.
async function setUp() {
  const botApi = createFakeBotApi();
  const clock = createManualClock(startMs);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const arrivals: { readonly method: string; readonly atMs: number }[] = [];
  const fetch: typeof botApi.fetch = async (input, init) => {
    const before = botApi.calls().length;
    const answer = await botApi.fetch(input, init);
    const method = botApi.calls()[before]?.method ?? "";
    arrivals.push({ method, atMs: clock.now() - startMs });
    return answer;
  };
  const api = new Api(fakeBotToken, { fetch });
  createBotThrottlers({ clock, logger }).install(api);
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const replies = createChatReplies({ api, owners, clock, logger, display });
  const typedAt = () =>
    arrivals.filter(({ method }) => method === "sendChatAction").map(({ atMs }) => atMs);
  return { botApi, clock, replies, typedAt };
}

function push(kind: string, data: JsonValue) {
  return { kind, data };
}

const started = push("chat/turnStarted", at);
const ended = push("chat/turnEnded", { agent, turn, outcome: "ok" });
const flood = { status: 429, description: "Too Many Requests", retryAfterS: 3 };

describe("the typing indicator in Telegram", () => {
  it("shows at the turn's start, renews every 4 s, and stops when the turn ends", async () => {
    const { clock, replies, typedAt } = await setUp();
    await replies.show(started, live);
    await clock.advance(12_500);
    const shown = replies.show(ended, live);
    await clock.advance(20_000);
    await shown;
    expect(typedAt()).toStrictEqual([0, 4_000, 8_000, 12_000]);
  });

  it("skips one Telegram answers with a 429 and sends none while the chat waits", async () => {
    const { botApi, clock, replies, typedAt } = await setUp();
    botApi.failNext("sendChatAction", flood, { chatId: ownerId });
    await replies.show(started, live);
    await clock.advance(5_000);
    replies.close();
    expect(typedAt()).toStrictEqual([0, 4_000]);
  });

  it("never holds the answer, which still waits out a 429 and goes", async () => {
    const { botApi, clock, replies, typedAt } = await setUp();
    await replies.show(started, live);
    botApi.failNext("sendMessage", flood, { chatId: ownerId });
    const answer = push("chat/message", { ...at, text: "Done.", final: true });
    const shown = replies.show(answer, live);
    await clock.advance(3_500);
    await shown;
    await replies.show(ended, live);
    await clock.advance(10_000);
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual(["Done."]);
    expect(typedAt()).toStrictEqual([0]);
  });

  it("stops after five failures in a row", async () => {
    const { botApi, clock, replies, typedAt } = await setUp();
    const refused = { status: 400, description: "Bad Request: chat not found" };
    for (const failure of [refused, refused, refused, refused, refused]) {
      botApi.failNext("sendChatAction", failure, { chatId: ownerId });
    }
    await replies.show(started, live);
    await clock.advance(30_000);
    replies.close();
    expect(typedAt()).toStrictEqual([0, 4_000, 8_000, 12_000, 16_000]);
  });
});
