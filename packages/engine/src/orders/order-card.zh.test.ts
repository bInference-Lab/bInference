import { cardLineText, createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { expectOk, testNowMs } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { createdOrder, startOrderEngine, testStopLoss } from "./test-orders.js";

const display = createFormatter({ locale: "zh", timeZone: "UTC" });

// The icons of spec 4, built from their code points: no emoji sits in code.
const waiting = String.fromCodePoint(0x1f7e1);
const paper = String.fromCodePoint(0x1f9ea);

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
      `批准限价单：当价格达到或低于 $0.50 时，用 $25.00 买入 TKN · 最多成交 1 次，截至 ${display.dateTime(testNowMs + 2_592_000_000)}`,
    ]);
  });
});
