import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { createBotCalls } from "./bot-calls.js";

const live = { signal: new AbortController().signal };

function setUp() {
  const botApi = createFakeBotApi();
  const calls = createBotCalls(new Api(fakeBotToken, { fetch: botApi.fetch }));
  return { botApi, calls };
}

describe("the bot's calls", () => {
  it("answer a press with a notice of Telegram's 200 characters whole", async () => {
    const { botApi, calls } = setUp();
    const notice = "a".repeat(200);
    await calls.answer("press-1", notice, live);
    expect(botApi.answers()).toStrictEqual([{ callbackId: "press-1", text: notice }]);
  });

  it("cut a longer notice under 200 characters and never inside one, so the press gets it", async () => {
    const { botApi, calls } = setUp();
    await calls.answer("press-1", `${"a".repeat(198)}\u{1F600}b`, live);
    expect(botApi.answers()).toStrictEqual([
      { callbackId: "press-1", text: `${"a".repeat(198)}…` },
    ]);
  });
});
