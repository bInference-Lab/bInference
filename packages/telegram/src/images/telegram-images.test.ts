import { createSecret } from "@binference/core";
import { ownerImageSourceContract, testPng } from "@binference/engine/testing";
import { maxImageBytes } from "@binference/protocol";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeBotApi, type FakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { createTelegramImages } from "./telegram-images.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const photo = "AgACAgIAAxkBAAIBY2Z";

function imagesOver(botApi: FakeBotApi) {
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  return createTelegramImages({
    api,
    download: botApi.download,
    token: createSecret(fakeBotToken),
  });
}

function setUp() {
  const botApi = createFakeBotApi();
  botApi.addFile(photo, { bytes: testPng });
  return { botApi, images: imagesOver(botApi) };
}

describe("the bot's images", () => {
  it.each(
    ownerImageSourceContract({
      create: async () => {
        const { botApi, images } = setUp();
        botApi.addFile("large", { bytes: new Uint8Array(maxImageBytes + 1) });
        return Promise.resolve({
          source: images,
          held: { image: `tg:${photo}`, bytes: testPng },
          large: "tg:large",
          gone: "tg:gone",
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses a file Telegram counts over 5 MiB before any download", async () => {
    const { botApi, images } = setUp();
    botApi.addFile("counted", { bytes: testPng, reportedSize: maxImageBytes + 1 });
    expect(await images.read("tg:counted", live())).toStrictEqual({
      ok: false,
      error: "too_large",
    });
    expect(botApi.downloads()).toBe(0);
  });

  it("refuses a file over 5 MiB that Telegram gives no size for, at the download", async () => {
    const { botApi, images } = setUp();
    botApi.addFile("uncounted", { bytes: new Uint8Array(maxImageBytes + 1), reportedSize: null });
    expect(await images.read("tg:uncounted", live())).toStrictEqual({
      ok: false,
      error: "too_large",
    });
  });

  it("refuses a file over the Bot API's 20 MB, which getFile refuses", async () => {
    const { botApi, images } = setUp();
    botApi.addFile("film", { bytes: new Uint8Array(20 * 1024 * 1024 + 1) });
    expect(await images.read("tg:film", live())).toStrictEqual({ ok: false, error: "too_large" });
  });

  it("refuses a name that is no file id of the bot's", async () => {
    const { images } = setUp();
    expect(await images.read("upl_chart", live())).toStrictEqual({
      ok: false,
      error: "unreadable",
    });
  });

  it("throws a retryable unreachable error that never holds the token", async () => {
    const { botApi, images } = setUp();
    botApi.failNext("getFile", "network");
    const failure = await images.read(`tg:${photo}`, live()).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "telegram.unreachable", retryable: true });
    expect(JSON.stringify(failure)).not.toContain(fakeBotToken);
  });

  it("goes through the bot's getFile, then downloads once", async () => {
    const { botApi, images } = setUp();
    await images.read(`tg:${photo}`, live());
    expect(botApi.calls().map((call) => call.method)).toStrictEqual(["getFile"]);
    expect(botApi.downloads()).toBe(1);
  });
});
