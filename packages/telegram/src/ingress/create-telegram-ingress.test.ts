import type { JsonValue } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
} from "@binference/core/testing";
import { createMemoryAccessStore, createMemoryInboxStore } from "@binference/engine/testing";
import { type MessageLocale, messages } from "@binference/i18n";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createMemoryOwnerStore } from "../fakes/memory-owner-store.js";
import { issueStartCode, startCodeLifetimeMs } from "../pairing/start-code.js";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId, pressUpdate, strangerId, textUpdate } from "../testing/update-fixtures.js";
import { createTelegramIngress } from "./create-telegram-ingress.js";
import type { OwnerUpdate } from "./decide-update.js";

const live = { signal: new AbortController().signal };
// A public BIP-39 test vector: 24 words, never a real wallet.
const twentyFourWords = [
  "legal winner thank year wave sausage worth useful",
  "legal winner thank year wave sausage worth useful",
  "legal winner thank year wave sausage worth title",
].join(" ");

async function setUp(options: { readonly owner?: number; readonly locale?: MessageLocale } = {}) {
  const botApi = createFakeBotApi();
  const stores = {
    inbox: createMemoryInboxStore(),
    access: createMemoryAccessStore(),
    owners: createMemoryOwnerStore(),
  };
  const clock = createManualClock(1_760_000_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const delivered: OwnerUpdate[] = [];
  const ingress = createTelegramIngress({
    api: new Api(fakeBotToken, { fetch: botApi.fetch }),
    stores,
    clock,
    logger,
    display: {
      timeZone: "UTC",
      ...(options.locale === undefined ? {} : { locale: options.locale }),
    },
    onOwnerUpdate: async (update) => {
      delivered.push(update);
      await Promise.resolve();
    },
  });
  if (options.owner !== undefined) {
    await stores.owners.bind({ userId: options.owner, pairedAtMs: 1 }, live);
  }
  const receive = async (...updates: readonly JsonValue[]): Promise<void> =>
    updates.reduce(async (previous, update) => {
      await previous;
      await ingress.receive(update, live);
    }, Promise.resolve());
  return { botApi, stores, clock, logger, delivered, ingress, receive };
}

async function startCode(context: Awaited<ReturnType<typeof setUp>>): Promise<string> {
  const issued = await issueStartCode(
    {
      access: context.stores.access,
      clock: context.clock,
      random: createSeededRandom(5),
      botUsername: "binference_test_bot",
    },
    live,
  );
  return new URL(issued.link.reveal()).searchParams.get("start") ?? "";
}

describe("the Telegram ingress", () => {
  it("ignores every message and button from anyone but the owner", async () => {
    const context = await setUp({ owner: ownerId });
    await context.receive(
      textUpdate({ updateId: 1, from: strangerId, text: "hello" }),
      textUpdate({ updateId: 2, from: strangerId, text: "/start abcdefghijklmnopqrstuv" }),
      textUpdate({ updateId: 3, from: strangerId, text: twentyFourWords }),
      pressUpdate(4, strangerId, "bnf1:c:y:abc"),
    );
    expect(context.delivered).toStrictEqual([]);
    expect(context.botApi.sent()).toStrictEqual([]);
    expect(context.botApi.deleted()).toStrictEqual([]);
    expect(await context.stores.inbox.unhandled(10, live)).toStrictEqual([]);
  });

  it("deletes a 24-word message from the owner unseen and answers with the warning", async () => {
    const context = await setUp({ owner: ownerId });
    const update = textUpdate({ updateId: 5, from: ownerId, text: twentyFourWords, messageId: 77 });
    await context.receive(update);
    expect(context.botApi.deleted()).toStrictEqual([{ chatId: ownerId, messageId: 77 }]);
    expect(context.botApi.sent()).toStrictEqual([
      { chatId: ownerId, text: messages.en["telegram.secretDeleted"] },
    ]);
    expect(context.delivered).toStrictEqual([]);
    const stored = await context.stores.inbox.admit(
      { source: "telegram", sourceKey: "tg:7012345678:5", payload: null, receivedAtMs: 0 },
      live,
    );
    expect(stored.kind).toBe("repeat");
    expect(JSON.stringify(stored.entry)).not.toMatch(/winner|sausage/);
    expect(JSON.stringify(context.logger.records())).not.toMatch(/winner|sausage/);
  });

  it("warns in the owner's language, or the language of the owner's Telegram", async () => {
    const chosen = await setUp({ owner: ownerId, locale: "zh" });
    await chosen.receive(textUpdate({ updateId: 6, from: ownerId, text: twentyFourWords }));
    const fromApp = await setUp({ owner: ownerId });
    const update = textUpdate({
      updateId: 7,
      from: ownerId,
      text: twentyFourWords,
      languageCode: "zh-hans",
    });
    await fromApp.receive(update);
    const warning = messages.zh["telegram.secretDeleted"];
    expect(chosen.botApi.sent().map((sent) => sent.text)).toStrictEqual([warning]);
    expect(fromApp.botApi.sent().map((sent) => sent.text)).toStrictEqual([warning]);
  });

  it("hands the owner's messages, edits and button presses on, and nothing twice", async () => {
    const context = await setUp({ owner: ownerId });
    const message = textUpdate({ updateId: 8, from: ownerId, text: "buy 0.1 BNB of CAKE" });
    const edit = textUpdate({ updateId: 9, from: ownerId, text: "buy 0.2", isEdit: true });
    const forward = textUpdate({ updateId: 10, from: ownerId, text: "news", isForwarded: true });
    await context.receive(
      message,
      edit,
      forward,
      pressUpdate(11, ownerId, "bnf1:c:y:abc"),
      message,
    );
    expect(context.delivered.map((update) => [update.kind, update.updateId])).toStrictEqual([
      ["message", 8],
      ["edit", 9],
      ["message", 10],
      ["callback", 11],
    ]);
    expect(context.delivered[2]).toMatchObject({ isForwarded: true, text: "news" });
  });

  it("ignores groups, bots and posts on behalf of a chat, even from the owner's id", async () => {
    const context = await setUp({ owner: ownerId });
    await context.receive(
      textUpdate({ updateId: 12, from: ownerId, text: "hi", chatId: -100, chatType: "group" }),
      textUpdate({ updateId: 13, from: ownerId, text: "hi", isBot: true }),
      textUpdate({
        updateId: 14,
        from: ownerId,
        text: twentyFourWords,
        chatId: -100,
        chatType: "supergroup",
      }),
      {
        update_id: 15,
        message: {
          message_id: 1,
          chat: { id: ownerId, type: "private" },
          from: { id: ownerId, is_bot: false },
          sender_chat: { id: -5 },
          text: "x",
        },
      },
      { update_id: 16, my_chat_member: { chat: { id: ownerId } } },
    );
    expect(context.delivered).toStrictEqual([]);
    expect(context.botApi.sent()).toStrictEqual([]);
    expect(context.botApi.deleted()).toStrictEqual([]);
  });

  it("makes the first person with a valid start code the owner", async () => {
    const context = await setUp();
    const code = await startCode(context);
    await context.receive(
      textUpdate({ updateId: 17, from: strangerId, text: "hello" }),
      textUpdate({ updateId: 18, from: ownerId, text: `/start ${code}` }),
      textUpdate({ updateId: 19, from: strangerId, text: `/start ${code}` }),
      textUpdate({ updateId: 20, from: ownerId, text: "status" }),
    );
    expect(await context.stores.owners.get(live)).toStrictEqual({
      userId: ownerId,
      pairedAtMs: context.clock.now(),
    });
    expect(context.botApi.sent()).toStrictEqual([
      { chatId: ownerId, text: messages.en["telegram.paired"] },
    ]);
    expect(context.delivered.map((update) => update.updateId)).toStrictEqual([20]);
  });

  it("answers the owner who opens the link again, and pairs nobody from a forward or an edit", async () => {
    const context = await setUp();
    const code = await startCode(context);
    await context.receive(
      textUpdate({ updateId: 21, from: ownerId, text: `/start ${code}`, isForwarded: true }),
      textUpdate({ updateId: 22, from: ownerId, text: `/start ${code}`, isEdit: true }),
    );
    expect(await context.stores.owners.get(live)).toBeUndefined();
    await context.receive(
      textUpdate({ updateId: 23, from: ownerId, text: `/start@binference_test_bot ${code}` }),
      textUpdate({ updateId: 24, from: ownerId, text: `/start ${code}` }),
    );
    expect(context.botApi.sent().map((sent) => sent.text)).toStrictEqual([
      messages.en["telegram.paired"],
      messages.en["telegram.paired"],
    ]);
  });

  it("refuses an unknown, expired or used start code and binds nobody", async () => {
    const context = await setUp();
    const code = await startCode(context);
    await context.receive(textUpdate({ updateId: 25, from: ownerId, text: "/start wrongcode" }));
    await context.clock.advance(startCodeLifetimeMs);
    await context.receive(textUpdate({ updateId: 26, from: ownerId, text: `/start ${code}` }));
    const fresh = await setUp();
    const used = await startCode(fresh);
    await fresh.stores.access.usePairCode(
      { codeHash: (await import("../pairing/start-code.js")).startCodeHash(used), atMs: 1 },
      live,
    );
    await fresh.receive(textUpdate({ updateId: 27, from: ownerId, text: `/start ${used}` }));
    const refused = messages.en["telegram.pairRefused"];
    expect(context.botApi.sent().map((sent) => sent.text)).toStrictEqual([refused, refused]);
    expect(fresh.botApi.sent().map((sent) => sent.text)).toStrictEqual([refused]);
    expect(await context.stores.owners.get(live)).toBeUndefined();
    expect(await fresh.stores.owners.get(live)).toBeUndefined();
  });

  it("leaves an update for the next pass while Telegram is unreachable", async () => {
    const context = await setUp({ owner: ownerId });
    context.botApi.failNext("deleteMessage", "network");
    await context.receive(textUpdate({ updateId: 28, from: ownerId, text: twentyFourWords }));
    expect(context.botApi.deleted()).toStrictEqual([]);
    expect(await context.stores.inbox.unhandled(10, live)).toHaveLength(1);
    await context.ingress.resume(live);
    expect(context.botApi.deleted()).toHaveLength(1);
    expect(context.botApi.sent()).toHaveLength(1);
    expect(await context.stores.inbox.unhandled(10, live)).toStrictEqual([]);
  });

  it("counts a message Telegram no longer has as deleted, and drops an update Telegram refuses", async () => {
    const context = await setUp({ owner: ownerId });
    context.botApi.failNext("deleteMessage", {
      status: 400,
      description: "message to delete not found",
    });
    await context.receive(textUpdate({ updateId: 29, from: ownerId, text: twentyFourWords }));
    expect(context.botApi.sent()).toHaveLength(1);
    context.botApi.failNext("sendMessage", {
      status: 403,
      description: "bot was blocked by the user",
    });
    await context.receive(textUpdate({ updateId: 30, from: ownerId, text: twentyFourWords }));
    expect(context.botApi.sent()).toHaveLength(1);
    expect(await context.stores.inbox.unhandled(10, live)).toStrictEqual([]);
    expect(context.logger.records().map((record) => record.fields.errorCode)).toContain(
      "telegram.api_refused",
    );
  });

  it("drops a stored entry it cannot read and handles the ones after it", async () => {
    const context = await setUp({ owner: ownerId });
    const draft = { source: "telegram", receivedAtMs: 1 } as const;
    await context.stores.inbox.admit(
      { ...draft, sourceKey: "tg:7012345678:31", payload: "?" },
      live,
    );
    await context.stores.inbox.admit(
      { ...draft, sourceKey: "tg:9:32", payload: "other bot" },
      live,
    );
    await context.receive(textUpdate({ updateId: 33, from: ownerId, text: "status" }));
    expect(context.delivered.map((update) => update.updateId)).toStrictEqual([33]);
    const left = await context.stores.inbox.unhandled(10, live);
    expect(left.map((entry) => entry.sourceKey)).toStrictEqual(["tg:9:32"]);
    expect(context.logger.records().map((record) => record.event)).toContain(
      "telegram.unreadable_entry",
    );
  });

  it("refuses to store an update without a whole update id", async () => {
    const context = await setUp({ owner: ownerId });
    await expect(context.ingress.receive({ message: {} }, live)).rejects.toMatchObject({
      code: "telegram.bad_update",
    });
  });
});
