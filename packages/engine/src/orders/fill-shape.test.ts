import { describe, expect, it } from "vitest";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import { testCoin } from "../intents/test-intents.js";
import type { IntentStore } from "../ports.js";
import { activeOrder, eightyCents, fillIntentsOf, startFillEngine } from "./test-fills.js";
import { testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

// An intent store that swaps what a fill's quote sells for the chain's coin as the quote is
// written, as a fault in building it would.
function sellingTheCoin(store: IntentStore, on: { readonly isOn: () => boolean }): IntentStore {
  return {
    ...store,
    transition: async (change, call) => {
      const quote = change.fields?.quote;
      if (!on.isOn() || change.state !== "quoted" || quote === undefined) {
        return store.transition(change, call);
      }
      const view = quoteDocument.decode(quote);
      const swapped = { ...view, amountIn: { ...view.amountIn, asset: testCoin } };
      const fields = { ...change.fields, quote: quoteDocument.encode(swapped) };
      return store.transition({ ...change, fields }, call);
    },
  };
}

describe("a fill held to its order's shape", () => {
  it("ends a fill whose quote sells another asset than its order's token", async () => {
    const state = { isOn: false };
    const on = { isOn: () => state.isOn };
    const test = await startFillEngine({ intents: (store) => sellingTheCoin(store, on) });
    const order = await activeOrder(test, testStopLoss());
    state.isOn = true;

    await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    expect(await fillIntentsOf(test)).toMatchObject([
      { state: "failed_check", reason: "fill_bounds" },
    ]);
  });
});
