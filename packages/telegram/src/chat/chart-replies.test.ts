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
const display = () => ({ locale: "en", timeZone: "UTC" }) as const;

async function setUp() {
  const botApi = createFakeBotApi();
  const clock = createManualClock(1_760_000_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  createBotThrottlers({ clock, logger }).install(api);
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const replies = createChatReplies({
    api,
    owners,
    clock,
    logger,
    display,
    replies: () => ({ stream: "progress" }),
  });
  return { botApi, replies };
}

const chart = {
  kind: "chat/chart",
  data: {
    agent,
    turn,
    chart: {
      chartType: "pie",
      title: "Holdings <b>",
      segments: [
        { label: "BNB", value: 3 },
        { label: "USDT", value: 1 },
      ],
    },
  },
};

describe("the chart the agent shows in Telegram", () => {
  it("sends the chart's text, its title in bold and its words as text", async () => {
    const { botApi, replies } = await setUp();
    await replies.show({ kind: "chat/turnStarted", data: at }, live);
    await replies.show(chart, live);
    const [message] = botApi.messages();
    expect(message?.text.split("\n")).toStrictEqual([
      "Holdings <b> (pie chart)",
      "- BNB: 3",
      "- USDT: 1",
    ]);
    expect(message?.entities).toMatchObject([{ type: "bold", offset: 0, length: 24 }]);
  });

  it("counts the chart as the turn's answer, so the turn ends with no other message", async () => {
    const { botApi, replies } = await setUp();
    await replies.show({ kind: "chat/turnStarted", data: at }, live);
    await replies.show(chart, live);
    await replies.show({ kind: "chat/turnEnded", data: { agent, turn, outcome: "ok" } }, live);
    expect(botApi.messages()).toHaveLength(1);
  });

  it("sends a chart of a turn it does not follow to the owner's chat", async () => {
    const { botApi, replies } = await setUp();
    await replies.show(chart, live);
    expect(botApi.messages()[0]?.text.split("\n")[0]).toBe("Holdings <b> (pie chart)");
  });
});
