import { describe, expect, it } from "vitest";
import { testToken } from "../intents/test-intents.js";
import type { OrderStore } from "./ports.js";
import { activeOrder, startFillEngine, wholeToken } from "./test-fills.js";
import { testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

// An order store that answers at most two orders a page, whatever a list asks for.
function twoAPage(store: OrderStore): OrderStore {
  return {
    ...store,
    list: async (query, call) => store.list({ ...query, limit: Math.min(query.limit, 2) }, call),
  };
}

describe("the price triggers over many active orders", () => {
  it("judges every active order, page after page, never only the first page", async () => {
    const test = await startFillEngine({ orders: twoAPage, tokens: 10n * wholeToken });
    await activeOrder(test, testStopLoss());
    await activeOrder(test, testStopLoss());
    await activeOrder(test, testStopLoss());
    const price = {
      token: testToken,
      usdPerBaseUnit: { numerator: 4n, denominator: 5n },
      decimals: 6,
      isThin: false,
    };

    const judged = await test.engine.seePrice(price, live);

    expect(judged).toHaveLength(3);
  });
});
