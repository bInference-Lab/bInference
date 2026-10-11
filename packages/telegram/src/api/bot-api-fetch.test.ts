import type { Http, HttpRequest } from "@binference/core";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import {
  createFakeBotApi,
  type FakeBotApi,
  fakeBotApiBase,
  fakeBotToken,
} from "../testing/fake-bot-api.js";
import { botApiRequestOf, createBotApiFetch } from "./bot-api-fetch.js";
import { callBotApi } from "./call-bot-api.js";

const live = (): AbortSignal => new AbortController().signal;

// The fake Bot API behind the Http port, with every request that reached it.
function recorded(botApi: FakeBotApi): { readonly http: Http; readonly sent: HttpRequest[] } {
  const sent: HttpRequest[] = [];
  return {
    sent,
    http: {
      request: async (request) => {
        sent.push(request);
        return botApi.http.request(request);
      },
    },
  };
}

function apiOver(http: Http, token = fakeBotToken): Api {
  return new Api(token, { fetch: createBotApiFetch(http) });
}

describe("grammY's fetch over the Http port", () => {
  it("sends each call with its method, URL, JSON and content type only", async () => {
    const botApi = createFakeBotApi();
    const { http, sent } = recorded(botApi);
    await apiOver(http).sendMessage(42, "hello");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      method: "POST",
      url: `${fakeBotApiBase}/sendMessage`,
      headers: { "content-type": "application/json" },
    });
    expect(sent[0]?.body).toBe('{"chat_id":42,"text":"hello"}');
    expect(botApi.sent().map((message) => message.text)).toStrictEqual(["hello"]);
  });

  it("brings Telegram's refusal back as grammY's error", async () => {
    const botApi = createFakeBotApi();
    const api = apiOver(
      recorded(botApi).http,
      "7012345678:AAE_aDifferentTokenTheFakeRefuses_01234",
    );
    await expect(
      callBotApi("getMe", live(), async (signal) => api.getMe(signal)),
    ).rejects.toMatchObject({ code: "telegram.bad_token" });
  });

  it("tells a request that never left from one whose answer was lost", async () => {
    const botApi = createFakeBotApi();
    const api = apiOver(recorded(botApi).http);
    botApi.failNext("getMe", "network");
    await expect(
      callBotApi("getMe", live(), async (signal) => api.getMe(signal)),
    ).rejects.toMatchObject({ code: "telegram.unreachable", details: { isUnsent: true } });
    botApi.failNext("getMe", "lostAnswer");
    await expect(
      callBotApi("getMe", live(), async (signal) => api.getMe(signal)),
    ).rejects.toMatchObject({ code: "telegram.unreachable", details: { isUnsent: false } });
  });

  it("stops a call when grammY's signal aborts", async () => {
    const botApi = createFakeBotApi();
    const api = apiOver(recorded(botApi).http);
    const controller = new AbortController();
    const waiting = callBotApi("getUpdates", controller.signal, async (signal) =>
      api.getUpdates({ timeout: 30 }, signal),
    );
    const reason = new Error("stopped by the test");
    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
  });

  it("refuses a file upload, which binference never sends", () => {
    const stream = new ReadableStream();
    expect(() =>
      botApiRequestOf("https://api.telegram.org/bot1:a/sendPhoto", { body: stream }),
    ).toThrow(expect.objectContaining({ code: "telegram.request_unsupported" }));
  });
});
