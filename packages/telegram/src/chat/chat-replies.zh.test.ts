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
const at = {
  agent,
  session: "ses_0190f1c2-3a4b-7c5d-8e6f-0123456789ab",
  turn: "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ab",
};

const display = () => ({ locale: "zh", timeZone: "Asia/Shanghai" }) as const;

async function setUp() {
  const botApi = createFakeBotApi();
  const clock = createManualClock(1_760_000_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  createBotThrottlers({ clock, logger }).install(api);
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const names = new Map([
    [agent, "侦察"],
    ["agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ac", "主账户"],
  ]);
  const agentNames = async () => Promise.resolve(names);
  const replies = createChatReplies({ api, owners, clock, logger, display, agentNames });
  return { botApi, clock, replies };
}

const answer = (text: string) => ({ kind: "chat/message", data: { ...at, text, final: true } });

describe("the agent's Chinese replies in Telegram", () => {
  it("shows the agent's Chinese Markdown as rich text after its name", async () => {
    const { botApi, replies } = await setUp();
    await replies.show(answer("当前为**模拟交易**模式。\n- 买入 `0.1 BNB`"), live);
    expect(botApi.messages()).toMatchObject([
      {
        text: "侦察 · 当前为模拟交易模式。\n• 买入 0.1 BNB",
        entities: [
          { type: "bold", offset: 8, length: 4 },
          { type: "code", offset: 21, length: 7 },
        ],
      },
    ]);
  });

  it("shows the status message with each tool's line in Chinese", async () => {
    const { botApi, clock, replies } = await setUp();
    await replies.show({ kind: "chat/turnStarted", data: at }, live);
    const draft = {
      kind: "chat/message",
      data: { ...at, text: "我先看看**持仓**。", final: false },
    };
    await replies.show(draft, live);
    const progress = { agent, turn: at.turn, progressKey: "turn.tool.portfolio" };
    await replies.show({ kind: "chat/progress", data: progress }, live);
    await clock.advance(0);
    await replies.idle();
    expect(botApi.messages()).toMatchObject([
      {
        text: "处理中 · 0 秒\n我先看看持仓。\n正在读取投资组合…",
        entities: [{ type: "bold", offset: 14, length: 2 }],
      },
    ]);
  });

  it("says in Chinese that an answer Telegram refused did not arrive", async () => {
    const { botApi, clock, replies } = await setUp();
    botApi.failNext("sendMessage", { status: 400, description: "Bad Request: chat not found" });
    const refused = replies.show(answer("完成。"), live).catch((error: unknown) => error);
    await clock.advance(2_000);
    expect(await refused).toMatchObject({ code: "telegram.api_refused" });
    expect(botApi.sent().map(({ text }) => text)).toStrictEqual([
      "⚠️ Agent 的回答未能发送到此对话。再次提问之前，请先在控制台或用 `binference chat` 查看。",
    ]);
  });

  it("sends Chinese text again as plain text when Telegram cannot parse its HTML", async () => {
    const { botApi, clock, replies } = await setUp();
    botApi.failNext(
      "sendMessage",
      { status: 400, description: "Bad Request: can't parse entities: unsupported start tag" },
      { chatId: ownerId },
    );
    const shown = replies.show(answer("**已卖出**，详见 [行情](https://dexscreener.com)"), live);
    await clock.advance(1_000);
    await shown;
    expect(botApi.messages()).toMatchObject([
      { text: "侦察 · 已卖出，详见 行情 (https://dexscreener.com)", entities: [] },
    ]);
  });

  it("says in Chinese that a turn ended with no answer", async () => {
    const { botApi, clock, replies } = await setUp();
    const turn = { agent, turn: at.turn };
    await replies.show({ kind: "chat/turnStarted", data: turn }, live);
    const shown = replies.show({ kind: "chat/turnEnded", data: turn }, live);
    await clock.advance(1_000);
    await shown;
    expect(botApi.messages().map(({ text }) => text)).toStrictEqual([
      "侦察 · 未生成回答，请再试一次。",
    ]);
  });
});
