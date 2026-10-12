import { describe, expect, it } from "vitest";
import {
  answerInCli,
  bot,
  buyUnlisted,
  createOrder,
  propose,
  stopLossUnlisted,
} from "./test-bot.js";

const chinese = () => ({ locale: "zh", timezone: "UTC" }) as const;

describe("the bot joined to the engine, in Chinese", () => {
  it("shows an order card for a token the registry does not list by what it answered", async () => {
    const test = await bot({ owner: chinese, knowsUnlisted: true });
    await createOrder(test, stopLossUnlisted);
    await test.telegram.idle();
    const [card] = test.botApi.messages().map(({ text }) => text.split("\n")[1]);
    expect(card).toMatch(
      /^批准止损：当价格跌至 \$0\.80 时，卖出你持有的全部 XVS（0x0000000f） · /u,
    );
  });

  it("shows a buy card for a token the registry does not list, then its receipt", async () => {
    const test = await bot({ owner: chinese, knowsUnlisted: true });
    const { intent } = await propose(test, buyUnlisted);
    await test.telegram.idle();
    const [card] = test.botApi.messages().map(({ text }) => text);
    await answerInCli(test, intent, "confirm");
    await test.telegram.idle();
    const [receipt] = test.botApi.messages().map(({ text }) => text);
    expect(card).toContain("用 0.01 FAKE 买入 XVS（0x0000000f）");
    expect(card).toContain("非已验证代币");
    expect(receipt).toMatch(/XVS（0x0000000f）$/u);
  });
});
