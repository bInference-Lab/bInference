import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { createMemoryOwnerStore } from "@binference/engine/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createBotThrottlers } from "../throttle/create-bot-throttlers.js";
import { createChatReplies } from "./chat-replies.js";

const live = { signal: new AbortController().signal };
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const at = { agent, session: "ses_0190f1c2-3a4b-7c5d-8e6f-0123456789ab", turn };
const display = () => ({ locale: "zh", timeZone: "Asia/Shanghai" }) as const;
const stream = () => ({ stream: "partial" }) as const;

describe("the partial reply mode in Chinese", () => {
  it("shows the Chinese label for a tool, then edits it into the Chinese answer", async () => {
    const botApi = createFakeBotApi();
    const clock = createManualClock(1_760_000_000_000);
    const logger = createMemoryLogger({ subsystem: "telegram" });
    const api = new Api(fakeBotToken, { fetch: botApi.fetch });
    createBotThrottlers({ clock, logger }).install(api);
    const owners = createMemoryOwnerStore();
    await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
    const replies = createChatReplies({ api, owners, clock, logger, display, replies: stream });
    await replies.show({ kind: "chat/turnStarted", data: at }, live);
    const progress = { agent, turn, progressKey: "turn.tool.quote" };
    await replies.show({ kind: "chat/progress", data: progress }, live);
    await clock.advance(0);
    await replies.idle();
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual(["处理中"]);
    const shown = replies.show(
      { kind: "chat/message", data: { ...at, text: "BNB 现价 **600** 美元。", final: true } },
      live,
    );
    await clock.advance(5_000);
    await shown;
    expect(botApi.messages()).toMatchObject([
      { text: "BNB 现价 600 美元。", entities: [{ type: "bold" }] },
    ]);
    expect(botApi.sent()).toHaveLength(1);
  });
});
