import { createManualClock, createSeededRandom } from "@binference/core/testing";
import type { EngineCaller } from "@binference/engine";
import { createMemoryAccessStore } from "@binference/engine/testing";
import { startCodeHash } from "@binference/telegram";
import { createFakeBotApi, fakeBotToken, fakeBotUsername } from "@binference/telegram/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createTelegramPair, pairingLifetimeMs } from "./telegram-pair.js";

const live = { signal: new AbortController().signal };
const cli: EngineCaller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "cli", version: "test" },
  scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
  transport: "ipc",
};

function setUp(options: { readonly hasBot: "yes" | "no" } = { hasBot: "yes" }) {
  const botApi = createFakeBotApi();
  const access = createMemoryAccessStore();
  const clock = createManualClock(1_800_000_000_000);
  const api = options.hasBot === "yes" ? new Api(fakeBotToken, { fetch: botApi.fetch }) : undefined;
  const handlers = createTelegramPair({ api, access, clock, random: createSeededRandom(9) });
  const pair = handlers["telegram/pair"];
  if (pair === undefined) {
    throw new Error("Expected the telegram/pair handler.");
  }
  return { botApi, access, clock, pair: async () => pair({ args: {}, caller: cli, ...live }) };
}

// The link and expiry a pairing answered, or a throw for a refusal.
function pairingOf(answer: Awaited<ReturnType<ReturnType<typeof setUp>["pair"]>>) {
  if (!answer.ok) {
    throw new Error(`Expected a pairing, got ${answer.error}.`);
  }
  const url = new URL(answer.value.link);
  return { url, code: url.searchParams.get("start") ?? "", expiresAt: answer.value.expiresAt };
}

describe("telegram/pair", () => {
  it("issues a start code for the bot that works once, for 10 minutes", async () => {
    const { access, clock, pair } = setUp();
    const { url, code, expiresAt } = pairingOf(await pair());
    expect(url.pathname).toBe(`/${fakeBotUsername}`);
    expect(expiresAt).toBe(clock.now() + pairingLifetimeMs);
    const codeHash = startCodeHash(code);
    const atMs = clock.now() + pairingLifetimeMs - 1;
    expect((await access.usePairCode({ codeHash, atMs }, live)).ok).toBe(true);
    expect((await access.usePairCode({ codeHash, atMs }, live)).ok).toBe(false);
  });

  it("fails as not running without the bot, and as unreachable offline", async () => {
    await expect(setUp({ hasBot: "no" }).pair()).resolves.toStrictEqual({
      ok: false,
      error: "telegram.not_running",
    });
    const offline = setUp();
    offline.botApi.failNext("getMe", "network");
    await expect(offline.pair()).resolves.toStrictEqual({
      ok: false,
      error: "telegram.unreachable",
    });
  });
});
