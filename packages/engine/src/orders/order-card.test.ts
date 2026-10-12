import { bpsSchema } from "@binference/core";
import { cardLineText, createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { expectOk, testNowMs } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { createdOrder, startOrderEngine, tapCard, testStopLoss } from "./test-orders.js";

const formatter = createFormatter({ locale: "en", timeZone: "UTC" });

// The card each order opens, line by line, as a surface without buttons writes it in English.
// Each order is confirmed before the next, so a later exit order's position holds an active one.
async function cardOf(requests: readonly Parameters<typeof createdOrder>[1][]) {
  const test = await startOrderEngine();
  return requests.reduce<Promise<readonly (readonly string[])[]>>(async (done, request) => {
    const texts = await done;
    const { intent } = await createdOrder(test, request);
    const card = expectOk(await test.engine.handlers["intent/card"](testCall({ intent })));
    await tapCard(test, intent, "confirm");
    const display = { formatter, assets: card.assets };
    return [...texts, card.lines.map((line) => cardLineText(line, display))];
  }, Promise.resolve([]));
}

// The icons of spec 4, built from their code points: no emoji sits in code.
const waiting = String.fromCodePoint(0x1f7e1);
const paper = String.fromCodePoint(0x1f9ea);

describe("an auto order's card in English", () => {
  it("shows the order's terms, the linked exits, what the agent says and the card's expiry", async () => {
    const [first, second] = await cardOf([
      undefined,
      { ...testStopLoss(), kind: "takeProfit", trigger: { price: 2_500_000n } },
    ]);

    expect(first).toStrictEqual([
      `${waiting} Confirm auto order · main · ${paper} Paper`,
      `Approve Stop-loss: sell all your TKN when the price falls to $0.80 · up to 1 fill until ${formatter.dateTime(testNowMs + 2_592_000_000)}`,
      `${paper} Paper mode: nothing is sent on chain`,
      'Agent says  "Protect the position as you asked"',
      `Expires at ${formatter.time(testNowMs + 600_000)}`,
    ]);
    expect(second).toContain(
      "When an exit order sells all your TKN, your other exit orders on it end",
    );
  });

  it("words a limit buy, a share sold by a trailing stop and an order with no fill limit", async () => {
    const [buy, trailing] = await cardOf([
      {
        ...testStopLoss(),
        kind: "limit",
        side: "buy",
        size: { usdMicros: 25_000_000n },
        trigger: { price: 500_000n, direction: "below" },
      },
      {
        ...testStopLoss(),
        kind: "trailing",
        size: { percentBps: bpsSchema.parse(5_000) },
        trigger: { distanceBps: bpsSchema.parse(800) },
      },
    ]);

    expect(buy?.[1]).toMatch(
      /^Approve Limit order: buy TKN with \$25\.00 when the price is at or below \$0\.50 · up to 1 fill until /,
    );
    expect(trailing?.[1]).toMatch(
      /^Approve Trailing stop: sell 50\.00% of your TKN when the price falls 8\.00% below its highest since the order started · no fill limit until /,
    );
  });
});
