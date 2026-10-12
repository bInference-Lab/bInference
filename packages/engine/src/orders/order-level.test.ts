import { createFakeVenue } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { expectOk, testToken } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import type { WatchedOrderPrice } from "./order-triggers.js";
import { activeOrder, fillIntentsOf, startFillEngine, wholeToken } from "./test-fills.js";
import { createdOrder, storedOrder, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

function deep(micros: bigint): WatchedOrderPrice {
  return {
    token: testToken,
    usdPerBaseUnit: { numerator: micros, denominator: wholeToken },
    decimals: 6,
    isThin: false,
  };
}

describe("a limit or take-profit order's level", () => {
  it("is its worst price when its request names none, and the card shows it", async () => {
    const test = await startFillEngine();
    const created = await createdOrder(test, {
      ...testStopLoss(),
      kind: "takeProfit",
      trigger: { price: 700_000n },
    });
    const card = expectOk(
      await test.engine.handlers["intent/card"](testCall({ intent: created.intent })),
    );
    expect(created.request.worstPrice).toBe(700_000n);
    expect(card.lines).toContainEqual({
      key: "card.order.worstPrice",
      values: { price: { type: "usd", usdMicros: 700_000n } },
    });
  });

  it("holds a deep pool's take-profit fill to its level at the fill's own quote", async () => {
    // The fake venue's quote prices the token far under the watcher: the fill's own price is not
    // at its target, whatever the pool's depth.
    const sixtyCents = createFakeVenue({ rate: { numerator: 10n ** 9n, denominator: 1n } });
    const test = await startFillEngine({ venues: [sixtyCents] });
    const order = await activeOrder(test, {
      ...testStopLoss(),
      kind: "takeProfit",
      trigger: { price: 700_000n },
      worstPrice: 1n,
    });

    const outcomes = await test.engine.seePrice(deep(800_000n), live);

    expect(outcomes).toStrictEqual([{ order: order.id, outcome: "skipped" }]);
    expect(await fillIntentsOf(test)).toMatchObject([
      { state: "failed_check", reason: "trigger_unconfirmed" },
    ]);
    expect((await storedOrder(test, order.id)).state).toBe("active");
  });
});
