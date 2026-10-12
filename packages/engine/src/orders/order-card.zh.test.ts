import { bpsSchema } from "@binference/core";
import { cardLineText, createFormatter } from "@binference/i18n";
import type { FillSize } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { expectOk, testNowMs } from "../intents/test-intents.js";
import { type TestEngine, testCall } from "../operations/test-engine.js";
import { createdOrder, startOrderEngine, testStopLoss } from "./test-orders.js";

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

  it("words a buy by share of what the wallet may spend, and by an amount", async () => {
    const test = await startOrderEngine();
    const byShare = await buySummary(test, { percentBps: bpsSchema.parse(2_500) });
    const byAmount = await buySummary(test, { base: 1_500_000_000_000_000_000n });

    expect([byShare, byAmount].map((text) => text.split(" · ")[0])).toStrictEqual([
      "批准限价单：当价格达到或低于 $0.50 时，用你可用的 FAKE 的 25.00% 买入 TKN",
      "批准限价单：当价格达到或低于 $0.50 时，用 1.5 FAKE 买入 TKN",
    ]);
  });
});
