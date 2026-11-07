import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { createMemoryOwnerStore } from "@binference/engine/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createBotThrottlers } from "../throttle/create-bot-throttlers.js";
import type { ReplySettings } from "./chat-replies-options.js";
import { createChatReplies } from "./chat-replies.js";

const live = { signal: new AbortController().signal };
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const display = () => ({ locale: "zh", timeZone: "Asia/Shanghai" }) as const;
const thought = "所有者在打招呼，简短回复即可。";

async function setUp(settings: ReplySettings) {
  const botApi = createFakeBotApi();
  const clock = createManualClock(1_760_000_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  createBotThrottlers({ clock, logger }).install(api);
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const shows = () => settings;
  const replies = createChatReplies({ api, owners, clock, logger, display, replies: shows });
  await replies.show({ kind: "chat/turnStarted", data: { agent, turn } }, live);
  return { botApi, clock, replies };
}

describe("the model's reasoning in Chinese", () => {
  it("streams it under the Chinese label with the Chinese marker", async () => {
    const { botApi, clock, replies } = await setUp({ stream: "progress", reasoning: "streamed" });
    await replies.show(
      { kind: "chat/reasoning", data: { agent, turn, text: thought, final: false } },
      live,
    );
    await clock.advance(1_500);
    await replies.idle();
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual([`处理中\n推理：${thought}`]);
  });

  it("keeps it as a message titled in Chinese", async () => {
    const { botApi, clock, replies } = await setUp({ stream: "progress", reasoning: "kept" });
    const shown = replies.show(
      { kind: "chat/reasoning", data: { agent, turn, text: thought, final: true } },
      live,
    );
    await clock.advance(1_000);
    await shown;
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual([`推理\n${thought}`]);
  });
});
