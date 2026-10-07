import { inspect } from "node:util";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeBotApi, fakeBotToken, fakeBotUsername } from "../testing/fake-bot-api.js";
import { createBotThrottlers } from "../throttle/create-bot-throttlers.js";
import { checkBotToken } from "./check-bot-token.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

function setUp(token = fakeBotToken) {
  const botApi = createFakeBotApi();
  const clock = createManualClock(1_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const api = new Api(token, { fetch: botApi.fetch });
  createBotThrottlers({ clock, logger }).install(api);
  return { botApi, clock, api };
}

// A Bot API that answers getMe with this result instead of the fake bot.
function answering(result: object) {
  const api = new Api(fakeBotToken, {
    fetch: async () => Promise.resolve(new Response(JSON.stringify({ ok: true, result }))),
  });
  return api;
}

describe("checking a bot token with getMe", () => {
  it("answers the bot the token opens, from one getMe call", async () => {
    const { botApi, api } = setUp();
    await expect(checkBotToken(api, live())).resolves.toStrictEqual({
      ok: true,
      value: {
        id: 7_012_345_678,
        username: fakeBotUsername,
        canJoinGroups: true,
        readsAllGroupMessages: false,
      },
    });
    expect(botApi.calls()).toStrictEqual([{ method: "getMe" }]);
  });

  it("answers rejected for a token Telegram refuses with 401 or 404", async () => {
    const refused = setUp("7012345678:AAE_anotherTokenTelegramDoesNotKnow_12");
    await expect(checkBotToken(refused.api, live())).resolves.toStrictEqual({
      ok: false,
      error: "rejected",
    });
    const { botApi, api } = setUp();
    botApi.failNext("getMe", { status: 404, description: "Not Found" });
    await expect(checkBotToken(api, live())).resolves.toStrictEqual({
      ok: false,
      error: "rejected",
    });
  });

  it.each(["", "not a token", "7012345678:short", "7012345678:AAE/fakeTokenForTestsOnly_01234"])(
    "answers malformed for %j and never sends it",
    async (token) => {
      const { botApi, api } = setUp(token);
      await expect(checkBotToken(api, live())).resolves.toStrictEqual({
        ok: false,
        error: "malformed",
      });
      expect(botApi.calls()).toStrictEqual([]);
    },
  );

  it("waits out a 429 for its retry_after, then answers the bot", async () => {
    const { botApi, clock, api } = setUp();
    botApi.failNext("getMe", { status: 429, description: "Too Many Requests", retryAfterS: 2 });
    const checking = checkBotToken(api, live());
    await clock.advance(2_000);
    await expect(checking).resolves.toMatchObject({ ok: true });
    expect(botApi.calls()).toStrictEqual([{ method: "getMe" }, { method: "getMe" }]);
  });

  it.each([
    [{ status: 500, description: "Internal Server Error" }, "telegram.api_refused", true],
    [{ status: 502, description: "Bad Gateway" }, "telegram.api_refused", true],
    [{ status: 400, description: "Bad Request" }, "telegram.api_refused", false],
    ["network", "telegram.unreachable", true],
  ] as const)("throws %j as %s without the token", async (failure, code, retryable) => {
    const { botApi, api } = setUp();
    botApi.failNext("getMe", failure);
    const fault = await checkBotToken(api, live()).catch((error: unknown) => error);
    expect(fault).toMatchObject({ code, retryable, details: { method: "getMe" } });
    expect(JSON.stringify(fault) + inspect(fault)).not.toContain(fakeBotToken);
  });

  it.each([
    { id: 1, is_bot: false, first_name: "a person", username: "someone_here" },
    { id: 1, is_bot: true, first_name: "no username" },
    { id: "1", is_bot: true, first_name: "text id", username: "binference_bot" },
  ])("throws bad_answer for a getMe answer that is no bot with a username: %j", async (result) => {
    await expect(checkBotToken(answering(result), live())).rejects.toMatchObject({
      code: "telegram.bad_answer",
    });
  });

  it("rejects with the signal's reason once the signal aborts", async () => {
    const { api } = setUp();
    const reason = new Error("stopped");
    await expect(checkBotToken(api, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  });
});
