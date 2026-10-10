import { BinferenceError, type Id, idSchema } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { type NoticeStore, noticeRecordOf } from "@binference/engine/notices";
import { type Notice, noticeText } from "@binference/engine/surfaces";
import {
  createMemoryAgentStore,
  createMemoryNoticeStore,
  createMemoryOwnerStore,
  testAgent,
  testAgentDraft,
} from "@binference/engine/testing";
import { createFormatter, type MessageLocale, messages } from "@binference/i18n";
import { parseMessage } from "@binference/i18n/check";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { testChains } from "../commands/test-command-bot.js";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createNoticeOutbox } from "./create-notice-outbox.js";

const live = { signal: new AbortController().signal };
const nowMs = Date.UTC(2026, 9, 11, 9, 30, 0);
const locked: Notice = { key: "notice.locked", values: {} };
const frozen: Notice = {
  key: "notice.frozen",
  agent: testAgent,
  values: { agent: "main", surface: "cli" },
};
const lockedText = `${String.fromCodePoint(0x1f534)} binference restarted and is locked. Run \`binference unlock\`.`;
const frozenText = `${String.fromCodePoint(0x1f534)} main is frozen from the CLI. Unfreeze in the CLI, the console or the Mini App.`;

const engineStopped = new BinferenceError({ code: "test.stopped", message: "The engine stopped." });

// A store the engine stops in front of once Telegram took a message, before the send is stored.
function stoppingBeforeSentIsStored(store: NoticeStore): NoticeStore {
  return {
    ...store,
    move: async (move, call) => {
      if (move.to === "sent") {
        throw engineStopped;
      }
      return store.move(move, call);
    },
  };
}

// The id of the n-th notice a test stores.
function noticeId(n: number): Id<"ntc"> {
  return idSchema("ntc").parse(`ntc_0190f1c2-3a4b-7c5d-8e6f-${String(n).padStart(12, "0")}`);
}

interface SetUpOptions {
  readonly isPaired?: boolean;
  readonly store?: (store: NoticeStore) => NoticeStore;
}

async function setUp(options: SetUpOptions = {}) {
  const botApi = createFakeBotApi();
  const owners = createMemoryOwnerStore();
  if (options.isPaired !== false) {
    await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  }
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft(), live);
  const store = createMemoryNoticeStore({ agents });
  const clock = createManualClock(nowMs);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const owner: { locale: MessageLocale } = { locale: "en" };
  const outboxOn = (notices: NoticeStore) =>
    createNoticeOutbox({
      api: new Api(fakeBotToken, { fetch: botApi.fetch }),
      owners,
      notices,
      chains: testChains(),
      display: () => ({ locale: owner.locale, timeZone: "UTC" }),
      clock,
      logger,
    });
  let stored = 0;
  const record = async (notice: Notice): Promise<void> => {
    stored += 1;
    const id = idSchema("ntc").parse(
      `ntc_0190f1c2-3a4b-7c5d-8e6f-${String(stored).padStart(12, "0")}`,
    );
    await store.record(
      noticeRecordOf(notice, { id, atMs: clock.now(), surfaces: ["telegram"] }),
      live,
    );
  };
  const outbox = outboxOn(options.store?.(store) ?? store);
  const delivered = async () =>
    (await store.list({ limit: 100 }, live)).map((notice) => notice.delivered.telegram);
  return { botApi, owners, store, clock, logger, owner, record, outbox, outboxOn, delivered };
}

// Each argument a notice's English message names, such as `{agent}` or `{mode, select}`, set to
// its own name.
function valuesOf(key: string): Readonly<Record<string, string>> {
  const parsed = parseMessage(messages.en[key] ?? "");
  const signatures = parsed.ok ? parsed.value.arguments : [];
  const names = signatures.map((signature) => /^\{(\w+)/u.exec(signature)?.[1] ?? signature);
  return Object.fromEntries(names.map((name) => [name, name]));
}

const noticeKeys = Object.keys(messages.en).filter((key) => key.startsWith("notice."));

describe("the owner's notices from the outbox", () => {
  it("sends each waiting notice oldest first, as plain text, and marks it sent", async () => {
    const test = await setUp();
    await test.record(locked);
    await test.record(frozen);
    await expect(test.outbox.send(live)).resolves.toStrictEqual({ kind: "done" });
    expect(test.botApi.sent()).toStrictEqual([
      { chatId: ownerId, text: lockedText },
      { chatId: ownerId, text: frozenText },
    ]);
    expect(test.botApi.messages().map((message) => message.entities)).toStrictEqual([[], []]);
    await expect(test.delivered()).resolves.toStrictEqual(["sent", "sent"]);
  });

  it("stops after the notice a pass runs through, so a later one waits for its own turn", async () => {
    const test = await setUp();
    await test.record(locked);
    await test.record(frozen);
    await expect(test.outbox.send({ ...live, through: noticeId(1) })).resolves.toStrictEqual({
      kind: "done",
    });
    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([lockedText]);
    await expect(test.delivered()).resolves.toStrictEqual(["sent", "queued"]);
  });

  it.each(["en", "zh"] as const)("draws every notice of the catalog in %s", async (locale) => {
    const test = await setUp();
    test.owner.locale = locale;
    await noticeKeys.reduce(async (previous, key) => {
      await previous;
      await test.record({ key, values: valuesOf(key) });
    }, Promise.resolve());
    await test.outbox.send(live);
    const display = {
      formatter: createFormatter({ locale, timeZone: "UTC" }),
      chains: testChains(),
    };
    const texts = test.botApi.sent().map((sent) => sent.text);
    expect(texts).toStrictEqual(
      noticeKeys.map((key) => noticeText({ key, values: valuesOf(key) }, display)),
    );
    expect(texts.filter((text) => /[{}]/u.test(text))).toStrictEqual([]);
    expect(noticeKeys).toContain("notice.lowGas");
  });

  it("holds every notice until the owner pairs, then sends them oldest first", async () => {
    const test = await setUp({ isPaired: false });
    await test.record(locked);
    await test.record(frozen);
    await expect(test.outbox.send(live)).resolves.toStrictEqual({ kind: "noOwner" });
    expect(test.botApi.calls()).toStrictEqual([]);
    await test.owners.bind({ userId: ownerId, pairedAtMs: nowMs }, live);
    await test.outbox.send(live);
    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([lockedText, frozenText]);
  });

  it("waits the retry_after of a 429, holding the notices behind it", async () => {
    const test = await setUp();
    await test.record(locked);
    await test.record(frozen);
    test.botApi.failNext("sendMessage", {
      status: 429,
      description: "Too Many Requests",
      retryAfterS: 7,
    });
    await expect(test.outbox.send(live)).resolves.toStrictEqual({
      kind: "waiting",
      atMs: nowMs + 7_000,
    });
    await expect(test.delivered()).resolves.toStrictEqual(["queued", "queued"]);
    await expect(test.outbox.send(live)).resolves.toStrictEqual({
      kind: "waiting",
      atMs: nowMs + 7_000,
    });
    expect(test.botApi.sent()).toStrictEqual([]);
    await test.clock.advance(7_000);
    await test.outbox.send(live);
    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([lockedText, frozenText]);
  });

  it("keeps a notice while the owner blocks the bot, trying again after a longer wait each time", async () => {
    const test = await setUp();
    await test.record(locked);
    const blocked = { status: 403, description: "Forbidden: bot was blocked by the user" };
    test.botApi.failNext("sendMessage", blocked);
    test.botApi.failNext("sendMessage", blocked);
    const first = await test.outbox.send(live);
    await test.clock.advance(5_000);
    const second = await test.outbox.send(live);
    await test.clock.advance(25_000);
    await test.outbox.send(live);
    expect([first, second]).toStrictEqual([
      { kind: "waiting", atMs: nowMs + 5_000 },
      { kind: "waiting", atMs: nowMs + 30_000 },
    ]);
    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([lockedText]);
    expect(test.logger.records()).toContainEqual(
      expect.objectContaining({
        event: "telegram.notice_waits",
        fields: { errorCode: "telegram.api_refused" },
      }),
    );
  });

  it("keeps a notice whose connection never opened and sends it after the wait", async () => {
    const test = await setUp();
    await test.record(locked);
    test.botApi.failNext("sendMessage", "network");
    await expect(test.outbox.send(live)).resolves.toStrictEqual({
      kind: "waiting",
      atMs: nowMs + 5_000,
    });
    await test.clock.advance(5_000);
    await test.outbox.send(live);
    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([lockedText]);
  });

  it("never sends again a notice whose answer was lost, and goes on after the wait", async () => {
    const test = await setUp();
    await test.record(locked);
    await test.record(frozen);
    test.botApi.failNext("sendMessage", "lostAnswer");
    await expect(test.outbox.send(live)).resolves.toStrictEqual({
      kind: "waiting",
      atMs: nowMs + 5_000,
    });
    await test.clock.advance(5_000);
    await expect(test.outbox.send(live)).resolves.toStrictEqual({ kind: "done" });
    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([lockedText, frozenText]);
    await expect(test.delivered()).resolves.toStrictEqual(["unknown_after_send", "sent"]);
  });

  it("never sends twice when the engine stops between the send and its record", async () => {
    const test = await setUp({ store: stoppingBeforeSentIsStored });
    await test.record(locked);
    await expect(test.outbox.send(live)).rejects.toBe(engineStopped);
    const restarted = test.outboxOn(test.store);
    await expect(restarted.send(live)).resolves.toStrictEqual({ kind: "done" });
    expect(test.botApi.calls()).toStrictEqual([{ method: "sendMessage", chatId: ownerId }]);
    await expect(test.delivered()).resolves.toStrictEqual(["unknown_after_send"]);
  });

  it("fails a notice Telegram refuses for good and sends the next", async () => {
    const test = await setUp();
    await test.record(locked);
    await test.record(frozen);
    test.botApi.failNext("sendMessage", {
      status: 400,
      description: "Bad Request: chat not found",
    });
    await expect(test.outbox.send(live)).resolves.toStrictEqual({ kind: "done" });
    expect(test.botApi.sent().map((sent) => sent.text)).toStrictEqual([frozenText]);
    await expect(test.delivered()).resolves.toStrictEqual(["failed", "sent"]);
  });

  it("writes each notice in the owner's language as it is when the notice goes", async () => {
    const test = await setUp();
    await test.record(locked);
    await test.outbox.send(live);
    test.owner.locale = "zh";
    await test.record(locked);
    await test.outbox.send(live);
    const han = /\p{Script=Han}/u;
    expect(test.botApi.sent().map((sent) => han.test(sent.text))).toStrictEqual([false, true]);
  });
});
