import { BinferenceError } from "@binference/core";
import type { EngineCaller } from "@binference/engine";
import { testAgent, testNowMs } from "@binference/engine/testing";
import { createFormatter } from "@binference/i18n";
import {
  createFakeBotApi,
  createMemoryCardCopyStore,
  createMemoryOwnerStore,
  type FakeBotApi,
  fakeBotToken,
} from "@binference/telegram/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import type { ComposedTelegram } from "./compose-telegram.js";
import { type ComposedSkeleton, composeSkeleton, skeletonCompositions } from "./test-skeleton.js";

const live = { signal: new AbortController().signal };
const ownerId = 7_012_345_678;
const [selfHosted] = skeletonCompositions;
const alarm = String.fromCodePoint(0x1f534);
const dayMs = 86_400_000;
const cli: EngineCaller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "cli", version: "test" },
  scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
  transport: "ipc",
};

/** The composed engine with the owner's bot on the synthetic Bot API. */
interface Bot extends ComposedSkeleton {
  readonly telegram: ComposedTelegram;
  readonly botApi: FakeBotApi;
}

interface BotOptions {
  readonly isPaired?: boolean;
}

function never(): never {
  throw new BinferenceError({ code: "test.missing", message: "The fixture holds it." });
}

async function bot(options: BotOptions = {}): Promise<Bot> {
  const botApi = createFakeBotApi();
  const owners = createMemoryOwnerStore();
  if (options.isPaired !== false) {
    await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  }
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  const telegram = { api, owners, copies: createMemoryCardCopyStore() };
  const skeleton = await composeSkeleton(selfHosted?.parts() ?? never(), { telegram });
  return { ...skeleton, telegram: skeleton.composed.telegram ?? never(), botApi };
}

async function freezeFromCli(test: Bot): Promise<void> {
  const frozen = await test.composed.engine.handlers["safety/freeze"]({
    args: {},
    caller: cli,
    ...live,
  });
  expect(frozen.ok).toBe(true);
  await test.telegram.idle();
}

describe("the engine's notices in the owner's chat", () => {
  it("sends the frozen notice when the CLI freezes every agent", async () => {
    const test = await bot();
    await freezeFromCli(test);
    expect(test.botApi.sent()).toStrictEqual([
      {
        chatId: ownerId,
        text: `${alarm} main is frozen from the CLI. Unfreeze in the CLI, the console or the Mini App.`,
      },
    ]);
  });

  it("announces a looser limit with its time, so the owner can cancel it", async () => {
    const test = await bot();
    const args = { agent: testAgent, changes: { perTradeUsdMicros: 10_000_000_000n } };
    const set = await test.composed.engine.handlers["limit/set"]({ args, caller: cli, ...live });
    expect(set.ok).toBe(true);
    await test.telegram.idle();
    const when = createFormatter({ locale: "en", timeZone: "UTC" }).dateTime(testNowMs + dayMs);
    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([
      `Limit changed by the CLI: the per-trade cap changes at ${when}. Not you? Cancel now.`,
    ]);
  });

  it("sends nothing before the owner pairs, and logs which agent's notice it held back", async () => {
    const test = await bot({ isPaired: false });
    await freezeFromCli(test);
    expect(test.botApi.calls()).toStrictEqual([]);
    expect(test.logger.records()).toContainEqual(
      expect.objectContaining({
        level: "info",
        event: "telegram.notice_not_sent",
        fields: { agentId: testAgent, errorCode: "no_owner" },
      }),
    );
  });

  it("logs a notice the Bot API refused, and sends the next", async () => {
    const test = await bot();
    test.botApi.failNext("sendMessage", { status: 403, description: "Forbidden: bot was blocked" });
    await freezeFromCli(test);
    test.telegram.relay({
      topic: "notice",
      kind: "notice/new",
      data: { key: "notice.locked", values: {} },
    });
    await test.telegram.idle();
    expect(test.logger.records()).toContainEqual(
      expect.objectContaining({
        level: "warn",
        event: "telegram.notice_not_sent",
        fields: { agentId: testAgent, errorCode: "telegram.api_refused" },
      }),
    );
    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([
      `${alarm} binference restarted and is locked. Run \`binference unlock\`.`,
    ]);
  });

  it("leaves an auto trade's receipt, which names its intent, and notice data it cannot read", async () => {
    const test = await bot();
    const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000009";
    test.telegram.relay({
      topic: "notice",
      kind: "notice/new",
      data: { key: "receipt.paper", agent: testAgent, intent, values: {} },
    });
    test.telegram.relay({ topic: "notice", kind: "notice/new", data: { key: "notice.locked" } });
    await test.telegram.idle();
    expect(test.botApi.calls()).toStrictEqual([]);
  });
});
