import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testLimits, testToken } from "../intents/test-intents.js";
import type { WatchedOrderPrice } from "./order-triggers.js";
import { activeOrder, fillRowsOf, noticesOf, startFillEngine, wholeToken } from "./test-fills.js";
import { testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

function at(micros: bigint): WatchedOrderPrice {
  return {
    token: testToken,
    usdPerBaseUnit: { numerator: micros, denominator: wholeToken },
    decimals: 6,
    isThin: false,
  };
}

const limitBuy = {
  ...testStopLoss(),
  kind: "limit",
  side: "buy",
  size: { base: 10n ** 15n },
  trigger: { price: 900_000n, direction: "below" },
  worstPrice: 1n,
  maxSlippageBps: bpsSchema.parse(50),
} as const;

describe("the pace of an order's fills after a skip", () => {
  it("lets a buy wait 15 seconds after a skip, then 30, and keeps the wait across a restart", async () => {
    // A per-trade cap of $0.10 refuses the buy's $0.60 at each try.
    const test = await startFillEngine({
      agent: { limits: { ...testLimits, perTradeUsdMicros: 100_000n } },
    });
    await activeOrder(test, limitBuy);
    const outcomesOf = async (see: typeof test.engine.seePrice) =>
      (await see(at(800_000n), live)).map(({ outcome }) => outcome);

    const first = await outcomesOf(test.engine.seePrice);
    const restarted = test.restart();
    const early = await outcomesOf(restarted.seePrice);
    await test.clock.advance(15_000);
    const second = await outcomesOf(restarted.seePrice);
    await test.clock.advance(15_000);
    const stillWaiting = await outcomesOf(restarted.seePrice);

    expect([first, early, second, stillWaiting]).toStrictEqual([
      ["skipped"],
      ["waiting"],
      ["skipped"],
      ["waiting"],
    ]);
  });

  it("tells the owner of a locked engine once for all of an agent's orders", async () => {
    const test = await startFillEngine({ isLocked: () => true });
    const stop = await activeOrder(test, testStopLoss());
    await activeOrder(test, { ...testStopLoss(), maxFills: 2 });

    await test.engine.seePrice(at(800_000n), live);
    await test.engine.seePrice(at(790_000n), live);

    expect(noticesOf(test)).toMatchObject([{ parts: { reason: { key: "reason.engine_locked" } } }]);
    expect((await fillRowsOf(test, stop.id)).length).toBe(2);
  });
});
