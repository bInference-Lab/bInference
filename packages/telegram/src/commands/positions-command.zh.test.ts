import { describe, expect, it } from "vitest";
import { ownerCards, pnlHandlers } from "../testing/pnl-card-fixtures.js";
import { startCommandBot } from "./test-command-bot.js";

const paper = String.fromCodePoint(0x1f9ea);
const red = String.fromCodePoint(0x1f534);

describe("the positions command in Chinese", () => {
  it("shows each P&L card in the owner's language, live before paper", async () => {
    const bot = await startCommandBot(pnlHandlers(ownerCards), { locale: "zh" });
    await bot.send("/positions");
    const [first] = bot.texts();
    expect(first?.split("\n\n")).toStrictEqual([
      `${red} 实盘持仓`,
      [
        `PEPE（0x6982…1933） · main · ${red} 实盘`,
        "持有 2 PEPE（0x6982…1933） · 市值 $6.00",
        "平均成本 $2.50 · 成本 $5.00",
        "盈亏 未实现盈亏 +$1.00（+20.00%）· 已实现盈亏 $0.00",
        "费用 平台手续费 $0.08 · 网络费 $0.02",
        "开始于 2026年10月8日 09:30:00",
      ].join("\n"),
      [
        `USDT · main · ${red} 实盘 · 已清仓`,
        "买入花费 $10.00 · 卖出收到 $9.50",
        "盈亏 已实现盈亏 -$0.50（-5.00%）",
        "费用 平台手续费 $0.08 · 网络费 $0.02",
        "持有 2026年10月8日 09:30:00 → 2026年10月9日 09:30:00（1 天）",
      ].join("\n"),
      `${paper} 模拟持仓`,
      [
        `BNB · scout · ${paper} 模拟`,
        "持有 1 BNB",
        "平均成本 $600.00 · 成本 $600.00",
        "盈亏 未实现盈亏：暂无价格 · 已实现盈亏 $0.00",
        "费用 平台手续费 $0.00 · 网络费 $0.00",
        "开始于 2026年10月8日 09:30:00",
      ].join("\n"),
    ]);
  });

  it("says when there is no position yet", async () => {
    const bot = await startCommandBot(pnlHandlers({}), { locale: "zh" });
    await bot.send("/positions");
    expect(bot.texts()).toStrictEqual(["还没有持仓。"]);
  });
});
