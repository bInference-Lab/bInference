import { ok } from "@binference/core";
import type { OrderView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { unlistedHandlers } from "../testing/unlisted-fixtures.js";
import { menuOf } from "./register-commands.js";
import { startCommandBot } from "./test-command-bot.js";

const nowMs = Date.UTC(2026, 9, 10, 9, 30, 0);
const alarm = String.fromCodePoint(0x1f534);

describe("the fast commands in Chinese", () => {
  it("answer in the owner's language, refusals too", async () => {
    const bot = await startCommandBot(
      { "safety/freeze": async () => Promise.resolve(ok({ frozenAt: nowMs })) },
      { locale: "zh" },
    );
    await bot.send("/freeze");
    await bot.send("/balance");
    await bot.send("/lang");
    expect(bot.texts()).toStrictEqual([
      `${alarm} 所有 Agent 都已冻结，自 2026年10月10日 09:30:00 起；在解除冻结之前新建的 Agent 也会处于冻结状态。它们已打开的卡片和未签名的操作都已取消；已发送的交易会继续完成。请在命令行、控制台或 Mini App 中解除冻结。`,
      "此版本的 binference 不支持该请求。请更新 binference 或客户端。",
      "binference 与你沟通使用中文。点按一种语言即可切换，binference 会立即生效。",
    ]);
  });

  it("name an unlisted token by its stored symbol and short address, as its card did", async () => {
    const bot = await startCommandBot(unlistedHandlers, { locale: "zh" });
    await bot.send("/orders");
    await bot.send("/balance");
    expect(bot.texts()).toStrictEqual([
      "止损 · 卖出 PEPE（0x6982…1933） · 价格为 $550.00 · 成交 0 次 · 2026年10月10日 09:30:00 到期",
      [
        `main · ${alarm} 实盘 · $0.00`,
        "  2 PEPE（0x6982…1933） · 暂无价格",
        `${alarm} 实盘 总计：$0.00`,
      ].join("\n"),
    ]);
  });

  it("name a copy order's leader and its dollars per buy", async () => {
    const leader = "fake:1:0x00000000000000000000000000000000000000d1";
    const trigger = { leader, perBuyUsdMicros: 20_000_000n, dailyUsdMicros: 200_000_000n };
    const copy = {
      order: "ord_0190f1c2-3a4b-7c5d-8e6f-0000000000c1",
      agent: "agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a1",
      wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-0000000000b1",
      kind: "copy",
      state: "active",
      request: { kind: "copy", side: "buy", size: { usdMicros: 20_000_000n }, trigger },
      fills: 0,
      expiresAt: nowMs,
      createdAt: nowMs,
      changedAt: nowMs,
    } as unknown as OrderView;
    const bot = await startCommandBot(
      { "order/list": async () => Promise.resolve(ok({ items: [copy], assets: {} })) },
      { locale: "zh" },
    );
    await bot.send("/orders");
    expect(bot.texts()).toStrictEqual([
      "跟单 · 跟单 0x0000…00d1，每笔买入最多 $20.00 · 成交 0 次 · 2026年10月10日 09:30:00 到期",
    ]);
  });

  it("register a Chinese menu line for every command, within Telegram's limits", () => {
    expect(menuOf("zh").map(({ command, description }) => [command, description])).toStrictEqual([
      ["balance", "每个钱包的美元总额和主要持仓"],
      ["positions", "每个持仓：数量、市值、平均成本和盈亏"],
      ["orders", "生效中的自动订单，及其触发条件和成交次数"],
      ["cancel", "取消一个等待你确认的操作"],
      ["freeze", "立即冻结所有 Agent"],
      ["rescue", "打开紧急转出卡片：Agent 钱包中的全部资产将转到你的紧急转出地址"],
      ["paper", "将 Agent 切换回模拟模式"],
      ["agents", "你的 Agent，以及此对话使用的 Agent"],
      ["use", "按名称选择此对话使用的 Agent"],
      ["status", "binference 的状态、Agent、冻结情况和健康状况"],
      ["limits", "Agent 的限额"],
      ["spend", "今日及本月的模型花费与预算"],
      ["ai", "Agent 的模型，可用按钮选择其他模型"],
      ["clear", "与 Agent 开始新的对话"],
      ["schedules", "Agent 的定时轮"],
      ["console", "在 Telegram 中打开控制台"],
      ["lang", "binference 与你沟通使用的语言"],
      ["help", "所有命令，每行一个"],
    ]);
  });
});
