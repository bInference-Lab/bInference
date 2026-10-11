import { ok } from "@binference/core";
import { describe, expect, it } from "vitest";
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

  it("register a Chinese menu line for every command, within Telegram's limits", () => {
    expect(menuOf("zh").map(({ command, description }) => [command, description])).toStrictEqual([
      ["balance", "每个钱包的美元总额和主要持仓"],
      ["positions", "每个持仓：数量、市值、平均成本和盈亏"],
      ["orders", "生效中的自动订单，及其触发条件和成交次数"],
      ["cancel", "取消一个等待你确认的操作"],
      ["freeze", "立即冻结所有 Agent"],
      ["rescue", "打开紧急转出卡片：Agent 钱包中的全部资产将转到你的紧急转出地址"],
      ["paper", "将 Agent 切换回模拟模式"],
      ["status", "binference 的状态、Agent、冻结情况和健康状况"],
      ["limits", "Agent 的限额"],
      ["console", "在 Telegram 中打开控制台"],
      ["lang", "binference 与你沟通使用的语言"],
      ["help", "所有命令，每行一个"],
    ]);
  });
});
