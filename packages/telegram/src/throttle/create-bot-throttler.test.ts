import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { Api, GrammyError } from "grammy";
import { describe, expect, it } from "vitest";
import { assertGrammySignal } from "../api/assert-grammy-signal.js";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId, strangerId } from "../testing/update-fixtures.js";
import { createBotThrottler } from "./create-bot-throttler.js";

const groupId = -1_001_234_567_890;

interface Arrival {
  readonly atMs: number;
  readonly method: string;
  readonly chatId?: number;
}

function setUp() {
  const botApi = createFakeBotApi();
  const clock = createManualClock(1_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const arrivals: Arrival[] = [];
  const api = new Api(fakeBotToken, {
    fetch: async (input: Parameters<typeof botApi.fetch>[0], init?: RequestInit) => {
      const before = botApi.calls().length;
      const answer = await botApi.fetch(input, init);
      const call = botApi.calls()[before];
      arrivals.push({ atMs: clock.now() - 1_000_000, ...call, method: call?.method ?? "" });
      return answer;
    },
  });
  api.config.use(createBotThrottler({ clock, logger }));
  return { botApi, clock, logger, api, arrivals };
}

function flood(retryAfterS: number) {
  return { status: 429, description: "Too Many Requests", retryAfterS };
}

// Tracks whether a call has settled, without awaiting it.
function watched<T>(call: Promise<T>) {
  const state = { isSettled: false };
  const done = call.finally(() => {
    state.isSettled = true;
  });
  return { state, done };
}

describe("the bot throttler", () => {
  it("waits out a 429 for its own chat only, and the caller never sees it", async () => {
    const { botApi, clock, logger, api, arrivals } = setUp();
    botApi.failNext("sendMessage", flood(3), { chatId: ownerId });
    const card = watched(api.sendMessage(ownerId, "card"));
    await clock.advance(0);
    const other = await api.sendMessage(strangerId, "another chat goes on");
    await clock.advance(2_999);
    expect(card.state.isSettled).toBe(false);
    await clock.advance(1);
    const sent = await card.done;
    expect(sent.text).toBe("card");
    expect(other.text).toBe("another chat goes on");
    expect(arrivals).toStrictEqual([
      { atMs: 0, method: "sendMessage", chatId: ownerId },
      { atMs: 0, method: "sendMessage", chatId: strangerId },
      { atMs: 3_000, method: "sendMessage", chatId: ownerId },
    ]);
    expect(logger.records()).toStrictEqual([
      {
        level: "warn",
        subsystem: "telegram",
        event: "telegram.flood_wait",
        fields: { durationMs: 3_000 },
      },
    ]);
  });

  it("keeps a chat paused for every call in its line until the wait is over", async () => {
    const { botApi, clock, api, arrivals } = setUp();
    botApi.failNext("sendMessage", flood(5), { chatId: ownerId });
    const first = api.sendMessage(ownerId, "first");
    const second = api.sendMessage(ownerId, "second");
    await clock.advance(5_000);
    await clock.advance(1_000);
    expect([(await first).text, (await second).text]).toStrictEqual(["first", "second"]);
    expect(arrivals.map((arrival) => arrival.atMs)).toStrictEqual([0, 5_000, 6_000]);
  });

  it("sends one chat's calls in order, a second apart", async () => {
    const { clock, api, arrivals } = setUp();
    const calls = ["one", "two", "three"].map(async (text) => api.sendMessage(ownerId, text));
    await clock.advance(2_000);
    const sent = await Promise.all(calls);
    expect(sent.map((message) => message.text)).toStrictEqual(["one", "two", "three"]);
    expect(arrivals.map((arrival) => arrival.atMs)).toStrictEqual([0, 1_000, 2_000]);
  });

  it("sends a group's calls three seconds apart", async () => {
    const { clock, api, arrivals } = setUp();
    const calls = [api.sendMessage(groupId, "one"), api.sendMessage(groupId, "two")];
    await clock.advance(3_000);
    await Promise.all(calls);
    expect(arrivals.map((arrival) => arrival.atMs)).toStrictEqual([0, 3_000]);
  });

  it("sends 30 calls a second at most across every chat", async () => {
    const { clock, api, arrivals } = setUp();
    const chats = Array.from({ length: 31 }, (_, index) => index + 1);
    const calls = chats.map(async (chatId) => api.sendMessage(chatId, "hello"));
    await clock.advance(1_000);
    await Promise.all(calls);
    const times = arrivals.map((arrival) => arrival.atMs);
    expect(times.filter((atMs) => atMs === 0)).toHaveLength(30);
    expect(times.at(-1)).toBe(1_000);
  });

  it("answers button presses at once, outside any chat's line", async () => {
    const { botApi, clock, api, arrivals } = setUp();
    botApi.failNext("sendMessage", flood(10), { chatId: ownerId });
    const card = api.sendMessage(ownerId, "card");
    await clock.advance(0);
    await api.answerCallbackQuery("press-1");
    await api.answerCallbackQuery("press-2");
    expect(arrivals.map((arrival) => [arrival.atMs, arrival.method])).toStrictEqual([
      [0, "sendMessage"],
      [0, "answerCallbackQuery"],
      [0, "answerCallbackQuery"],
    ]);
    await clock.advance(10_000);
    await card;
  });

  it("hands the 429 to the caller once its waits pass five minutes", async () => {
    const { botApi, clock, api } = setUp();
    botApi.failNext("sendMessage", flood(200), { chatId: ownerId });
    botApi.failNext("sendMessage", flood(200), { chatId: ownerId });
    const card = api.sendMessage(ownerId, "card").catch((error: unknown) => error);
    await clock.advance(200_000);
    expect(await card).toBeInstanceOf(GrammyError);
    expect(await card).toMatchObject({ error_code: 429 });
  });

  it("stops a paused call when its caller stops, and keeps the chat paused", async () => {
    const { botApi, clock, api, arrivals } = setUp();
    botApi.failNext("sendMessage", flood(30), { chatId: ownerId });
    const caller = new AbortController();
    const stopped = api
      .sendMessage(ownerId, "card", {}, assertGrammySignal(caller.signal))
      .catch((error: unknown) => error);
    await clock.advance(0);
    caller.abort(new Error("the engine stopped"));
    expect(await stopped).toMatchObject({ message: "the engine stopped" });
    const next = api.sendMessage(ownerId, "next");
    await clock.advance(30_000);
    await next;
    expect(arrivals.map((arrival) => arrival.atMs)).toStrictEqual([0, 30_000]);
  });

  it("stops a call waiting in its chat's line when its caller stops", async () => {
    const { clock, api } = setUp();
    const first = api.sendMessage(ownerId, "first");
    const caller = new AbortController();
    caller.abort(new Error("stopped before its turn"));
    const waiting = api.sendMessage(ownerId, "second", {}, assertGrammySignal(caller.signal));
    await expect(waiting).rejects.toThrow("stopped before its turn");
    await clock.advance(0);
    await first;
  });

  it("lets the poller's getUpdates through untouched, 429 and all", async () => {
    const { botApi, api } = setUp();
    botApi.failNext("getUpdates", flood(5));
    await expect(api.getUpdates({ timeout: 0 })).rejects.toMatchObject({ error_code: 429 });
  });
});
