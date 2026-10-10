import { noticeSchema } from "@binference/engine/surfaces";
import type { MessageLocale } from "@binference/i18n";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { testChains } from "../commands/test-command-bot.js";
import { createMemoryOwnerStore } from "../fakes/memory-owner-store.js";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createTelegramNotices } from "./create-telegram-notices.js";

const live = { signal: new AbortController().signal };
const atMs = Date.UTC(2026, 9, 11, 9, 30, 0);
const limitChange = noticeSchema.parse({
  key: "notice.limitChange",
  values: { surface: "mini", limit: "rollingDayUsdMicros", pending: "yes" },
  times: { when: atMs },
});

async function setUp(options: { readonly isPaired?: boolean } = {}) {
  const botApi = createFakeBotApi();
  const owners = createMemoryOwnerStore();
  if (options.isPaired !== false) {
    await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  }
  const owner: { locale: MessageLocale } = { locale: "en" };
  const notices = createTelegramNotices({
    api: new Api(fakeBotToken, { fetch: botApi.fetch }),
    owners,
    chains: testChains(),
    display: () => ({ locale: owner.locale, timeZone: "UTC" }),
  });
  return { botApi, notices, owner };
}

describe("the engine's notices in the owner's chat", () => {
  it("sends a notice to the owner's chat as plain text, its times in the owner's timezone", async () => {
    const { botApi, notices } = await setUp();
    await expect(notices.send(limitChange, live)).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(botApi.sent()).toStrictEqual([
      {
        chatId: ownerId,
        text: "Limit changed by the Mini App: the 24-hour cap changes at Oct 11, 2026, 09:30:00. Not you? Cancel now.",
      },
    ]);
    expect(botApi.messages()[0]?.entities).toStrictEqual([]);
  });

  it("sends nothing before an owner is bound", async () => {
    const { botApi, notices } = await setUp({ isPaired: false });
    await expect(notices.send(limitChange, live)).resolves.toStrictEqual({
      ok: false,
      error: "no_owner",
    });
    expect(botApi.calls()).toStrictEqual([]);
  });

  it("follows the owner's language as it is when each notice goes", async () => {
    const { botApi, notices, owner } = await setUp();
    await notices.send(limitChange, live);
    owner.locale = "zh";
    await notices.send(limitChange, live);
    const han = /\p{Script=Han}/u;
    expect(botApi.sent().map((sent) => han.test(sent.text))).toStrictEqual([false, true]);
  });

  it("rejects with the Bot API's fault, so the relay logs it", async () => {
    const { botApi, notices } = await setUp();
    botApi.failNext("sendMessage", {
      status: 403,
      description: "Forbidden: bot was blocked by the user",
    });
    await expect(notices.send(limitChange, live)).rejects.toMatchObject({
      code: "telegram.api_refused",
    });
  });
});
