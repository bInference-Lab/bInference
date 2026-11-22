import { createSecret } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { testPng } from "@binference/engine/testing";
import { createFakeBotApi, fakeBotToken } from "@binference/telegram/testing";
import { describe, expect, it } from "vitest";
import { openBot } from "./open-bot.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const ownerId = 7_012_345_678;

async function botWith(ports: { readonly canDownload: boolean }) {
  const botApi = createFakeBotApi();
  botApi.addFile("AgACphoto", { bytes: testPng });
  const opened = await openBot({
    source: { fromEnv: "BOT_TOKEN" },
    secrets: { read: async () => Promise.resolve(createSecret(fakeBotToken)) },
    http: botApi.http,
    ...(ports.canDownload ? { download: botApi.download } : {}),
    clock: createManualClock(0),
    logger: createMemoryLogger({ subsystem: "telegram" }),
    signal: live().signal,
  });
  return opened?.images;
}

describe("openBot", () => {
  it("reads the owner's photos through the bot when it can download", async () => {
    const images = await botWith({ canDownload: true });
    await expect(images?.read("tg:AgACphoto", live())).resolves.toStrictEqual({
      ok: true,
      value: testPng,
    });
  });

  it("reads no photo without a download port", async () => {
    await expect(botWith({ canDownload: false })).resolves.toBeUndefined();
  });

  it("opens a bot whose messages and edits show no link preview", async () => {
    const botApi = createFakeBotApi();
    const opened = await openBot({
      source: { fromEnv: "BOT_TOKEN" },
      secrets: { read: async () => Promise.resolve(createSecret(fakeBotToken)) },
      http: botApi.http,
      clock: createManualClock(0),
      logger: createMemoryLogger({ subsystem: "telegram" }),
      signal: live().signal,
    });
    const api = opened?.api;
    const sent = await api?.sendMessage(ownerId, "Done · https://bscscan.com/tx/0x1");
    expect(sent?.message_id).toBeTypeOf("number");
    expect(botApi.calls()).toStrictEqual([{ method: "sendMessage", chatId: ownerId }]);
  });
});
