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

const target = { chatId: 42 };
const codeLine = {
  block: { kind: "text" },
  runs: [{ text: "0x00000010", marks: [{ kind: "code" }] }],
} as const;

describe("the bot's calls", () => {
  it("send rich lines as Telegram HTML, the address as code", async () => {
    const { botApi, calls } = setUp();
    await calls.sayRich(target, [codeLine], live);
    expect(botApi.messages()).toMatchObject([
      { text: "0x00000010", entities: [{ type: "code", offset: 0, length: 10 }] },
    ]);
  });

  it("send rich lines again as plain text when Telegram cannot parse their HTML", async () => {
    const { botApi, calls } = setUp();
    botApi.failNext("sendMessage", {
      status: 400,
      description: "Bad Request: can't parse entities: unsupported start tag",
    });
    await calls.sayRich(target, [codeLine], live);
    expect(botApi.messages()).toMatchObject([{ text: "0x00000010", entities: [] }]);
  });

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
