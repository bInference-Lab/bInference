import { BinferenceError } from "@binference/core";
import type { EngineCaller } from "@binference/engine";
import { createMemoryCardCopyStore, createMemoryOwnerStore } from "@binference/engine/testing";
import { createFakeBotApi, fakeBotToken } from "@binference/telegram/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { composeSkeleton, skeletonCompositions } from "./test-skeleton.js";

const live = { signal: new AbortController().signal };
const ownerId = 7_012_345_678;
const [selfHosted] = skeletonCompositions;
const cli: EngineCaller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "cli", version: "test" },
  scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
  transport: "ipc",
};

function never(): never {
  throw new BinferenceError({ code: "test.missing", message: "The fixture holds it." });
}

// The skeleton with the owner's bot, the owner reading Chinese in Shanghai.
async function chineseBot() {
  const botApi = createFakeBotApi();
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  const skeleton = await composeSkeleton(selfHosted?.parts() ?? never(), {
    telegram: { api, owners, copies: createMemoryCardCopyStore() },
    owner: () => ({ locale: "zh", timezone: "Asia/Shanghai" }),
  });
  const { engine, telegram } = skeleton.composed;
  return { botApi, engine, telegram: telegram ?? never() };
}

describe("the engine's notices in a Chinese owner's chat", () => {
  it("sends the frozen notice in Chinese", async () => {
    const { botApi, engine, telegram } = await chineseBot();
    telegram.start();
    await engine.handlers["safety/freeze"]({ args: {}, caller: cli, ...live });
    await telegram.idle();
    expect(botApi.sent().map((sent) => sent.text)).toStrictEqual([
      `${String.fromCodePoint(0x1f534)} 已从 命令行 冻结 main。请在命令行、控制台或 Mini App 中解除冻结。`,
    ]);
  });
});
