import { describe, expect, it } from "vitest";
import { fixtureDay } from "./test-summary-day.js";
import { startSummaryRig, summariesIn } from "./test-summary-rig.js";

// The live and paper icons the card spec names.
const liveIcon = String.fromCodePoint(0x1f534);
const paperIcon = String.fromCodePoint(0x1f9ea);

/** The fixture day's summary, as the owner reads it in Chinese. */
const fixtureSummary = [
  "main 的每日摘要（过去 24 小时）",
  `${liveIcon} 实盘：$1,200.00，24 小时变化 +$50.00；已实现盈亏 +$12.40`,
  `${paperIcon} 模拟：$600.00，24 小时变化 -$12.40；已实现盈亏 -$3.10`,
  "自动订单：已成交 3 次，跳过 3 次，挂单 3 个",
  "模型花费：$1.20，每日模型预算 $5.00",
  "1 张卡片等你回复",
  "Agent 在等你回答它的问题",
  "1 项放宽的限额将在 24 小时内生效",
  "1 个钱包因链上交易卡住而等待",
  "跳过 2 次：钱包中这种代币不足",
  "跳过 1 次：将超过你的 24 小时上限",
].join("\n");

describe("the daily summary of a fixture day in Chinese", () => {
  it("tells the day in Chinese, live and paper on lines of their own", async () => {
    const rig = await startSummaryRig();
    await fixtureDay(rig);
    await rig.run();
    expect(summariesIn(rig, "zh")).toStrictEqual([fixtureSummary]);
  });
});
