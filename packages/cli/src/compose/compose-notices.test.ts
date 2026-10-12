import { BinferenceError, createSecret } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import type { EngineCaller } from "@binference/engine";
import type { NoticeStore } from "@binference/engine/notices";
import {
  createMemoryCardCopyStore,
  createMemoryOwnerStore,
  testAgent,
  testNowMs,
} from "@binference/engine/testing";
import { createFormatter, messages } from "@binference/i18n";
import { issueStartCode } from "@binference/telegram";
import {
  createFakeBotApi,
  type FakeBotApi,
  fakeBotToken,
  fakeBotUsername,
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
const frozenText = `${alarm} main is frozen from the CLI. Unfreeze in the CLI, the console or the Mini App.`;
const cli: EngineCaller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "cli", version: "test" },
  scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
  transport: "ipc",
};

const engineStopped = new BinferenceError({ code: "test.stopped", message: "The engine stopped." });

// A notice store the engine stops in front of once, after Telegram took a message and before the
// send is stored.
function stoppingOnceBeforeSent(store: NoticeStore): NoticeStore {
  let stops = 1;
  return {
    ...store,
    move: async (move, call) => {
      if (move.to === "sent" && stops > 0) {
        stops -= 1;
        throw engineStopped;
      }
      return store.move(move, call);
    },
  };
}

/** The composed engine with the owner's bot on the synthetic Bot API. */
interface Bot extends ComposedSkeleton {
  readonly telegram: ComposedTelegram;
  readonly botApi: FakeBotApi;
}

interface BotOptions {
  readonly isPaired?: boolean;
  /** Wraps the engine's notice store, as a fault-injection test does. */
  readonly notices?: (store: NoticeStore) => NoticeStore;
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
  const telegram = {
    api,
    owners,
    copies: createMemoryCardCopyStore(),
    botToken: createSecret(fakeBotToken),
  };
  const parts = selfHosted?.parts() ?? never();
  const notices = options.notices?.(parts.stores.notices) ?? parts.stores.notices;
  const skeleton = await composeSkeleton(
    { ...parts, stores: { ...parts.stores, notices } },
    { telegram },
  );
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

// The owner opens the bot's start link: the ingress binds them and the notices that waited go.
async function pairOwner(test: Bot): Promise<void> {
  const issued = await issueStartCode(
    {
      access: test.parts.stores.access,
      clock: test.clock,
      random: createSeededRandom(5),
      botUsername: fakeBotUsername,
    },
    live,
  );
  const code = new URL(issued.link.reveal()).searchParams.get("start");
  const from = { id: ownerId, is_bot: false, first_name: "Owner" };
  const chat = { id: ownerId, type: "private" };
  const message = { message_id: 1, date: 1, chat, from, text: `/start ${code ?? ""}` };
  await test.telegram.ingress.receive({ update_id: 1, message }, live);
  await test.telegram.idle();
}

describe("the engine's notices in the owner's chat", () => {
  it("sends the frozen notice when the CLI freezes every agent", async () => {
    const test = await bot();
    test.telegram.start();
    await freezeFromCli(test);
    expect(test.botApi.sent()).toStrictEqual([{ chatId: ownerId, text: frozenText }]);
  });

  it("announces a looser limit with its time and its agent, so the owner can cancel it", async () => {
    const test = await bot();
    test.telegram.start();
    const args = { agent: testAgent, changes: { perTradeUsdMicros: 10_000_000_000n } };
    const set = await test.composed.engine.handlers["limit/set"]({ args, caller: cli, ...live });
    expect(set.ok).toBe(true);
    await test.telegram.idle();
    const when = createFormatter({ locale: "en", timeZone: "UTC" }).dateTime(testNowMs + dayMs);
    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([
      `main · Limit changed by the CLI: the per-trade cap changes at ${when}. Not you? Cancel now.`,
    ]);
  });

  it("keeps what the engine announced before the bot started, and sends it at the start", async () => {
    const test = await bot();
    await freezeFromCli(test);
    expect(test.botApi.calls()).toStrictEqual([]);
    test.telegram.start();
    await test.telegram.idle();
    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([frozenText]);
  });

  it("holds a notice until the owner pairs, then sends it after the welcome", async () => {
    const test = await bot({ isPaired: false });
    test.telegram.start();
    await freezeFromCli(test);
    expect(test.botApi.calls()).toStrictEqual([]);
    await pairOwner(test);
    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([
      messages.en["telegram.paired"],
      frozenText,
    ]);
  });

  it("keeps a notice the Bot API refused, and sends it once its wait is over", async () => {
    const test = await bot();
    test.telegram.start();
    test.botApi.failNext("sendMessage", { status: 403, description: "Forbidden: bot was blocked" });
    await freezeFromCli(test);
    expect(test.botApi.sent()).toStrictEqual([]);
    expect(test.logger.records()).toContainEqual(
      expect.objectContaining({
        event: "telegram.notice_waits",
        fields: { agentId: testAgent, errorCode: "telegram.api_refused" },
      }),
    );
    await test.clock.advance(5_000);
    await test.telegram.idle();
    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([frozenText]);
  });

  it("stores nothing and sends nothing for an auto trade's receipt, which names its intent", async () => {
    const test = await bot();
    test.telegram.start();
    const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000009";
    test.composed.publish({
      topic: "notice",
      kind: "notice/new",
      data: { key: "receipt.paper", agent: testAgent, intent, values: {} },
    });
    await test.telegram.idle();
    expect(test.botApi.calls()).toStrictEqual([]);
    expect(await test.parts.stores.notices.list({ limit: 10 }, live)).toStrictEqual([]);
  });

  it("sends nothing for a kind the owner muted, and still sends a security notice", async () => {
    const test = await bot();
    test.telegram.start();
    const args = { agent: testAgent, muted: ["lowGas"] };
    const muted = await test.composed.engine.handlers["notice/setSettings"]({
      args,
      caller: cli,
      ...live,
    });
    expect(muted.ok).toBe(true);
    test.composed.publish({
      topic: "notice",
      kind: "notice/new",
      data: {
        key: "notice.lowGas",
        agent: testAgent,
        values: { wallet: "Main", balance: "0.001 BNB" },
      },
    });
    await test.telegram.idle();
    await freezeFromCli(test);
    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([frozenText]);
    const kept = await test.parts.stores.notices.list({ limit: 10 }, live);
    const delivered = Object.fromEntries(kept.map((notice) => [notice.kind, notice.delivered]));
    expect(delivered).toStrictEqual({ lowGas: {}, frozen: { telegram: "sent" } });
  });

  it("never sends a notice twice when the engine stops between its send and its record", async () => {
    const test = await bot({ notices: stoppingOnceBeforeSent });
    test.telegram.start();
    await freezeFromCli(test);
    const limit = { agent: testAgent, changes: { perTradeUsdMicros: 1n } };
    const set = await test.composed.engine.handlers["limit/set"]({
      args: limit,
      caller: cli,
      ...live,
    });
    expect(set.ok).toBe(true);
    await test.telegram.idle();
    const texts = test.botApi.sent().map((sent) => sent.text);
    expect(texts.filter((text) => text === frozenText)).toHaveLength(1);
    expect(texts).toHaveLength(2);
    const kept = await test.parts.stores.notices.list({ limit: 10 }, live);
    const delivered = Object.fromEntries(kept.map((notice) => [notice.kind, notice.delivered]));
    expect(delivered).toStrictEqual({
      frozen: { telegram: "unknown_after_send" },
      limitChange: { telegram: "sent" },
    });
  });
});
