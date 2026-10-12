import { ok } from "@binference/core";
import { protocolIdSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { startCommandBot } from "./test-command-bot.js";

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a1");
const tokens = { inputTokens: 1_000, outputTokens: 100, cachedTokens: 0 };
const row = { agent, dayAt: Date.UTC(2025, 9, 9), model: "openai/gpt-5.4", ...tokens };

describe("the spend command in Chinese", () => {
  it("answers today's and this month's spend in the owner's language", async () => {
    const answer = {
      rows: [{ ...row, usdMicros: 3_000_000n }],
      budgets: [{ agent, dailyUsdMicros: 3_000_000n, leftUsdMicros: 0n }],
    };
    const bot = await startCommandBot(
      { "usage/get": async () => Promise.resolve(ok(answer)) },
      { locale: "zh" },
    );
    await bot.send("/spend");

    expect(bot.texts()).toStrictEqual([
      [
        `${agent}：今日模型预算 $3.00，已花费 $3.00，剩余 $0.00`,
        "对话暂停至 2025年10月10日 00:00:00；自动订单继续运行。",
        "本月：$3.00",
        "openai/gpt-5.4：本月 $3.00",
      ].join("\n"),
    ]);
  });
});
