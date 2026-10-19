import { assetRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { cardLineText, createFormatter } from "@binference/i18n";
import type { FillSize } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFakeTokenFacts } from "../fakes/fake-token-facts.js";
import { expectOk, testNowMs } from "../intents/test-intents.js";
import { type TestEngine, testCall } from "../operations/test-engine.js";
import { createdOrder, startOrderEngine, testCopy, testStopLoss } from "./test-orders.js";

const display = createFormatter({ locale: "zh", timeZone: "UTC" });

// The icons of spec 4, built from their code points: no emoji sits in code.
const waiting = String.fromCodePoint(0x1f7e1);
const paper = String.fromCodePoint(0x1f9ea);

// The summary line of a limit buy's card of the given size, in Chinese.
async function buySummary(test: TestEngine, size: FillSize): Promise<string> {
  const buy = { ...testStopLoss(), kind: "limit", side: "buy", size } as const;
  const trigger = { price: 500_000n, direction: "below" } as const;
  const { intent } = await createdOrder(test, { ...buy, trigger });
  const card = expectOk(await test.engine.handlers["intent/card"](testCall({ intent })));
  const [, summary] = card.lines;
  if (summary === undefined) {
    throw new Error("Expected the card's summary line.");
  }
  return cardLineText(summary, { formatter: display, assets: card.assets });
}

describe("an auto order's card in Chinese", () => {
  it("shows the order's terms in the owner's language", async () => {
    const test = await startOrderEngine();
    const { intent } = await createdOrder(test, {
      ...testStopLoss(),
      kind: "limit",
      side: "buy",
      size: { usdMicros: 25_000_000n },
      trigger: { price: 500_000n, direction: "below" },
    });
    const card = expectOk(await test.engine.handlers["intent/card"](testCall({ intent })));
    const lines = card.lines.map((line) =>
      cardLineText(line, { formatter: display, assets: card.assets }),
    );

    expect(lines.slice(0, 2)).toStrictEqual([
      `${waiting} 确认自动订单 · main · ${paper} 模拟`,
      `批准限价单：当价格达到或低于 $0.50 时，用价值 $25.00 的 FAKE 买入 TKN · 最多成交 1 次，截至 ${display.dateTime(testNowMs + 2_592_000_000)}`,
    ]);
  });

  it("words a copy order's leader, its dollars per buy and a day, and its sales", async () => {
    const test = await startOrderEngine();
    const { intent } = await createdOrder(test, testCopy());
    const card = expectOk(await test.engine.handlers["intent/card"](testCall({ intent })));
    const [, summary] = card.lines.map((line) =>
      cardLineText(line, { formatter: display, assets: card.assets }),
    );

    expect(summary?.split(" · ")[0]).toBe(
      "批准跟单：跟单 0x00000009 的买入，每笔 $20.00，每天最多 $200.00；按 0x00000009 卖出的持仓比例同步卖出",
    );
  });

  it("words a DCA order's period, its zone and its count of buys", async () => {
    const test = await startOrderEngine();
    const { intent } = await createdOrder(test, {
      ...testStopLoss(),
      kind: "dca",
      side: "buy",
      size: { usdMicros: 10_000_000n },
      trigger: { cron: "0 9 * * 1-5", timezone: "Asia/Shanghai", count: 20 },
    });
    const card = expectOk(await test.engine.handlers["intent/card"](testCall({ intent })));
    const [, summary] = card.lines.map((line) =>
      cardLineText(line, { formatter: display, assets: card.assets }),
    );

    expect(summary?.split(" · ")[0]).toBe(
      "批准定投：按计划 0 9 * * 1-5（Asia/Shanghai），首次 2027年1月18日 01:00:00，第二次 2027年1月19日 01:00:00，用价值 $10.00 的 FAKE 买入 TKN，共 20 次",
    );
  });

  it("words a buy by share of what the wallet may spend, and by an amount", async () => {
    const test = await startOrderEngine();
    const byShare = await buySummary(test, { percentBps: bpsSchema.parse(2_500) });
    const byAmount = await buySummary(test, { base: 1_500_000_000_000_000_000n });

    expect([byShare, byAmount].map((text) => text.split(" · ")[0])).toStrictEqual([
      "批准限价单：当价格达到或低于 $0.50 时，用你可用的 FAKE 的 25.00% 买入 TKN",
      "批准限价单：当价格达到或低于 $0.50 时，用 1.5 FAKE 买入 TKN",
    ]);
  });

  it("names a token the registry does not list by what it answered, with its short address", async () => {
    const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
    const facts = new Map([[unlisted, { symbol: "XVS", name: "Venus", decimals: 18 }]]);
    const test = await startOrderEngine({ tokenFacts: createFakeTokenFacts({ facts }).read });
    const { intent } = await createdOrder(test, testStopLoss({ token: unlisted }));
    const card = expectOk(await test.engine.handlers["intent/card"](testCall({ intent })));
    const [, summary] = card.lines.map((line) =>
      cardLineText(line, { formatter: display, assets: card.assets }),
    );

    expect(summary?.split(" · ")[0]).toBe(
      "批准止损：当价格跌至 $0.80 时，卖出你持有的全部 XVS（0x0000000f）",
    );
  });
});
