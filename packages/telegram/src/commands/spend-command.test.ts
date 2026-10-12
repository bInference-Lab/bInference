import { ok } from "@binference/core";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import { protocolIdSchema, type ResultOf } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { startCommandBot } from "./test-command-bot.js";

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a1");
// The test bot's clock reads 2025-10-09T08:53:20Z, and the owner lives in UTC.
const today = Date.UTC(2025, 9, 9);
const monthStart = Date.UTC(2025, 9, 1);
const nowMs = 1_760_000_000_000;
const sonnet = "anthropic/claude-sonnet-4-6";
const gpt = "openai/gpt-5.4";
const tokens = { inputTokens: 1_000, outputTokens: 100, cachedTokens: 0 };

/** Usage over this month: $3 today, $1.50 on the 3rd. */
const usage: ResultOf<"usage/get"> = {
  rows: [
    { agent, dayAt: Date.UTC(2025, 9, 3), model: sonnet, ...tokens, usdMicros: 1_500_000n },
    { agent, dayAt: today, model: sonnet, ...tokens, usdMicros: 2_100_000n },
    { agent, dayAt: today, model: gpt, ...tokens, usdMicros: 900_000n },
  ],
  budgets: [{ agent, dailyUsdMicros: 3_000_000n, leftUsdMicros: 0n }],
};

function servedWith(answer: ResultOf<"usage/get">, asked: unknown[]): OwnerChatHandlers {
  return {
    "usage/get": async ({ args }) => {
      asked.push(args);
      return Promise.resolve(ok(answer));
    },
  };
}

describe("the spend command", () => {
  it("reads this month's usage and answers today's spend against the budget, and when chat resumes", async () => {
    const asked: unknown[] = [];
    const bot = await startCommandBot(servedWith(usage, asked));
    await bot.send("/spend");

    expect(asked).toStrictEqual([{ from: monthStart, to: nowMs + 1 }]);
    expect(bot.texts()).toStrictEqual([
      [
        `${agent}: $3.00 of today's $3.00 model budget spent, $0.00 left`,
        "Chat is paused until Oct 10, 2025, 00:00:00; orders keep running.",
        "This month: $4.50",
        `${sonnet}: $3.60 this month`,
        `${gpt}: $0.90 this month`,
      ].join("\n"),
    ]);
    expect(bot.chat).toStrictEqual([]);
  });

  it("says nothing of a pause while some of the budget is left", async () => {
    const budgets = [{ agent, dailyUsdMicros: 5_000_000n, leftUsdMicros: 2_000_000n }];
    const bot = await startCommandBot(servedWith({ ...usage, budgets }, []));
    await bot.send("/spend");

    expect(bot.texts()[0]?.split("\n").slice(0, 2)).toStrictEqual([
      `${agent}: $3.00 of today's $5.00 model budget spent, $2.00 left`,
      "This month: $4.50",
    ]);
  });

  it("says so when there is no agent", async () => {
    const bot = await startCommandBot(servedWith({ rows: [], budgets: [] }, []));
    await bot.send("/spend");

    expect(bot.texts()).toStrictEqual([
      "binference has no agent yet, so nothing is spent on models.",
    ]);
  });
});
