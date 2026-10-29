import { describe, expect, it } from "vitest";
import {
  answerInCli,
  bot,
  buyUnlisted,
  createOrder,
  frozenThenUnfreezing,
  inAutoMode,
  propose,
  stopLossUnlisted,
  tapConfirm,
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

  it("turns an auto order's card into the order it made active once the owner taps Confirm", async () => {
    const test = await bot({ owner: chinese, knowsUnlisted: true });
    await createOrder(test, stopLossUnlisted);
    await tapConfirm(test);
    const [receipt] = test.botApi.messages();
    expect(receipt).toMatchObject({ buttons: [] });
    expect(receipt?.text).toMatch(
      /^.+ 模拟自动订单已生效：止损，当价格跌至 \$0\.80 时，卖出你持有的全部 XVS（0x0000000f），截至 .+$/u,
    );
  });

  it("turns an unfreeze's card into the agent it unfroze once the owner taps Confirm", async () => {
    const test = await bot({ owner: chinese });
    await frozenThenUnfreezing(test);
    await tapConfirm(test);
    const receipts = test.botApi.messages().filter(({ text }) => text.includes("已解除冻结"));
    expect(receipts).toMatchObject([
      {
        text: `${String.fromCodePoint(0x2705)} 已解除冻结：main 可以在交易限额内再次交易`,
        buttons: [],
      },
    ]);
  });

  it("says on the card why auto mode asks, naming the MCP client that proposed", async () => {
    const test = await bot({ owner: chinese });
    await inAutoMode(test);
    await propose(test);
    await test.telegram.idle();
    const [card] = test.botApi.messages().map(({ text }) => text.split("\n"));
    expect(card?.at(-3)).toBe("自动模式在此需要你确认：由 mcp 提出");
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
