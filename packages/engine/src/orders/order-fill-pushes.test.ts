import { describe, expect, it } from "vitest";
import { testAgent, testLimits } from "../intents/test-intents.js";
import {
  activeOrder,
  eightyCents,
  fillPushesOf,
  fillRowsOf,
  noticesOf,
  startFillEngine,
} from "./test-fills.js";
import { testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

describe("the order topic's pushes of fills and skips", () => {
  it("pushes a paper fill's row once, as order/filled, with its intent", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, testStopLoss());

    await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    const [row] = await fillRowsOf(test, order.id);
    expect(fillPushesOf(test.pushes)).toStrictEqual([
      {
        kind: "order/filled",
        data: {
          order: order.id,
          agent: testAgent,
          fill: { fill: row?.id, intent: row?.intentId, outcome: "filled", at: row?.atMs },
        },
      },
    ]);
  });

  it("pushes every skip before an intent as order/skipped, those the owner is not told of too", async () => {
    const test = await startFillEngine({ tokens: 0n });
    const order = await activeOrder(test, testStopLoss({ maxFills: 2 }));

    await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);
    await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    const rows = await fillRowsOf(test, order.id);
    const pushed = fillPushesOf(test.pushes);
    expect(pushed.map(({ kind }) => kind)).toStrictEqual(["order/skipped", "order/skipped"]);
    expect(pushed.map(({ data }) => data.fill.fill)).toStrictEqual(
      rows.map(({ id }) => id).toReversed(),
    );
    expect(pushed.map(({ data }) => data.fill.reason)).toStrictEqual([
      "nothing_to_sell",
      "nothing_to_sell",
    ]);
    expect(noticesOf(test)).toHaveLength(1);
  });

  it("pushes the skip of a fill whose intent the policy refused once, naming its intent", async () => {
    // A per-trade cap of $0.10 refuses the sale's $0.80.
    const test = await startFillEngine({
      agent: { limits: { ...testLimits, perTradeUsdMicros: 100_000n } },
    });
    const order = await activeOrder(test, testStopLoss());

    await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    const [row] = await fillRowsOf(test, order.id);
    expect(row).toMatchObject({ outcome: "skipped", reason: "per_trade_cap" });
    expect(fillPushesOf(test.pushes)).toStrictEqual([
      {
        kind: "order/skipped",
        data: {
          order: order.id,
          agent: testAgent,
          fill: {
            fill: row?.id,
            intent: row?.intentId,
            outcome: "skipped",
            reason: "per_trade_cap",
            at: row?.atMs,
          },
        },
      },
    ]);
  });
});
