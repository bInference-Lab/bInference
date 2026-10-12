import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testToken } from "../intents/test-intents.js";
import type { WatchedOrderPrice } from "./order-triggers.js";
import {
  activeOrder,
  fillIntentsOf,
  noticesOf,
  startFillEngine,
  wholeToken,
} from "./test-fills.js";
import { storedOrder, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

function at(micros: bigint): WatchedOrderPrice {
  return {
    token: testToken,
    usdPerBaseUnit: { numerator: micros, denominator: wholeToken },
    decimals: 6,
    isThin: false,
  };
}

const quarterTrailing = {
  ...testStopLoss(),
  kind: "trailing",
  size: { percentBps: bpsSchema.parse(2_500) },
  trigger: { distanceBps: bpsSchema.parse(1_000) },
} as const;

describe("an order after its fill", () => {
  it("sells a trailing stop once by default, however long the price stays under its stop", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, quarterTrailing);

    await test.engine.seePrice(at(1_000_000n), live);
    const outcomes = [
      await test.engine.seePrice(at(890_000n), live),
      await test.engine.seePrice(at(880_000n), live),
      await test.engine.seePrice(at(870_000n), live),
    ];

    expect(outcomes.map((each) => each.map(({ outcome }) => outcome))).toStrictEqual([
      ["filled"],
      [],
      [],
    ]);
    expect(await storedOrder(test, order.id)).toMatchObject({
      state: "filled",
      fills: 1,
      maxFills: 1,
    });
  });

  it("re-arms an order with fills left only once its condition stops holding", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, { ...quarterTrailing, maxFills: 3 });

    await test.engine.seePrice(at(1_000_000n), live);
    const first = await test.engine.seePrice(at(890_000n), live);
    const stillUnder = await test.engine.seePrice(at(800_000n), live);
    const peakAgain = await test.engine.seePrice(at(900_000n), live);
    const dropAgain = await test.engine.seePrice(at(810_000n), live);

    expect([first, stillUnder, peakAgain, dropAgain].map((each) => each.length)).toStrictEqual([
      1, 0, 0, 1,
    ]);
    expect((await storedOrder(test, order.id)).fills).toBe(2);
  });

  it("ends an exit order whose own fill sold the whole position, with no notice of an outside sale", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, { ...testStopLoss(), maxFills: 2 });

    await test.engine.seePrice(at(800_000n), live);
    const after = await test.engine.seePrice(at(700_000n), live);

    expect(after).toStrictEqual([]);
    expect(await storedOrder(test, order.id)).toMatchObject({
      state: "ended",
      endReason: "position_closed",
      fills: 1,
    });
    expect(await fillIntentsOf(test)).toHaveLength(1);
    expect(noticesOf(test)).toMatchObject([{ key: "notice.fill" }]);
  });
});
