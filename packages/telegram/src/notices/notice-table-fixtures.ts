import { idSchema } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { noticeRecordOf } from "@binference/engine/notices";
import {
  createMemoryAgentStore,
  createMemoryNoticeStore,
  createMemoryOwnerStore,
  testAgentDraft,
} from "@binference/engine/testing";
import type { MessageLocale } from "@binference/i18n";
import { noticeTable, noticeTableAtMs } from "@binference/i18n/testing";
import { Api } from "grammy";
import { testChains } from "../commands/test-command-bot.js";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createNoticeOutbox } from "./create-notice-outbox.js";

const live = { signal: new AbortController().signal };

/** What the owner's chat showed for the notice table: each key's text, and where it went. */
export interface SentTable {
  readonly texts: Readonly<Record<string, string>>;
  readonly chats: readonly number[];
}

/**
 * Stores every notice of the engine's notice table in key order, sends them through the outbox
 * to the synthetic Bot API in `locale`, in UTC, and answers the text the owner's chat showed for
 * each key.
 */
export async function sentNoticeTable(locale: MessageLocale): Promise<SentTable> {
  const botApi = createFakeBotApi();
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft(), live);
  const notices = createMemoryNoticeStore({ agents });
  const entries = Object.entries(noticeTable);
  await entries.reduce(async (previous, [, notice], at) => {
    await previous;
    const id = idSchema("ntc").parse(
      `ntc_0190f1c2-3a4b-7c5d-8e6f-${String(at + 1).padStart(12, "0")}`,
    );
    const stamp = { id, atMs: noticeTableAtMs, surfaces: ["telegram"] as const };
    await notices.record(noticeRecordOf(notice, stamp), live);
  }, Promise.resolve());
  const outbox = createNoticeOutbox({
    api: new Api(fakeBotToken, { fetch: botApi.fetch }),
    owners,
    notices,
    agents,
    chains: testChains(),
    display: () => ({ locale, timeZone: "UTC" }),
    clock: createManualClock(noticeTableAtMs),
    logger: createMemoryLogger({ subsystem: "telegram" }),
  });
  await outbox.send(live);
  const sent = botApi.sent();
  const texts = Object.fromEntries(entries.map(([key], at) => [key, sent[at]?.text ?? ""]));
  return { texts, chats: [...new Set(sent.map((each) => each.chatId))] };
}
