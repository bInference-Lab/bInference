import { bpsSchema } from "@binference/core";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { testNowMs } from "../intents/test-intents.js";
import { shownRule, testRuleRequest } from "./test-webhook-rules.js";

const formatter = createFormatter({ locale: "zh", timeZone: "UTC" });

// The icons of spec 4, built from their code points: no emoji sits in code.
const waiting = String.fromCodePoint(0x1f7e1);
const paper = String.fromCodePoint(0x1f9ea);
const check = String.fromCodePoint(0x2705);

const thirtyDaysMs = 2_592_000_000;

describe("a webhook rule's card in Chinese", () => {
  it("shows its name, what each alert trades, its rate, its limits, its URL and paper only", async () => {
    const { card, receipt } = await shownRule("zh", testRuleRequest({ maxFills: 3 }));
    const expiry = formatter.dateTime(testNowMs + thirtyDaysMs);

    expect(card).toStrictEqual([
      `${waiting} 确认提醒规则 · main · ${paper} 模拟`,
      "批准提醒规则“BNB breakout”：每次提醒时卖出你持有的 TKN 的 50.00% · 每分钟最多 5 次",
      `最多成交 3 次，截至 ${expiry}`,
      "确认后其地址才会生效；任何持有该地址的人都可以在规则范围内触发此规则",
      "它只在模拟模式下成交，即使此 Agent 转为实盘也是如此：提醒规则暂不交易实盘资金",
      `${paper} 模拟模式：不会发送链上交易`,
      `过期时间 ${formatter.time(testNowMs + 600_000)}`,
    ]);
    expect(receipt).toBe(
      `${check} 提醒规则“BNB breakout”已生效：每次提醒时卖出你持有的 TKN 的 50.00%，截至 ${expiry}`,
    );
  });

  it("words a buy with what it spends", async () => {
    const request = testRuleRequest({
      side: "buy",
      size: { usdMicros: 25_000_000n },
      maxSlippageBps: bpsSchema.parse(40),
    });
    const { card } = await shownRule("zh", request);

    expect(card[1]).toBe(
      "批准提醒规则“BNB breakout”：每次提醒时用价值 $25.00 的 FAKE 买入 TKN · 每分钟最多 5 次",
    );
    expect(card[2]).toMatch(/^不限成交次数，截至 /);
    expect(card[3]).toBe("每次成交的滑点最多 0.40%");
  });
});
