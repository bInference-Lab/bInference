import type { OrderRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { IntentChange } from "../intents/intent-change.js";
import type { IntentStore } from "../ports.js";
import {
  activeOrder,
  eightyCents,
  fillIntentsOf,
  fillRowsOf,
  noticesOf,
  startFillEngine,
} from "./test-fills.js";
import { testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

// An intent store whose write of a quote throws once armed, as a store fault does mid-fill.
function failingAtQuote(store: IntentStore, fault: { readonly isArmed: boolean }): IntentStore {
  return {
    ...store,
    transition: async (change: IntentChange, call) => {
      if (fault.isArmed && change.state === "quoted") {
        throw new Error("The disk is full.");
      }
      return store.transition(change, call);
    },
  };
}

const limitBuy: OrderRequest = {
  ...testStopLoss(),
  kind: "limit",
  side: "buy",
  size: { base: 10n ** 15n },
  trigger: { price: 1_000_000n, direction: "below" },
  maxFills: 2,
};

describe("an auto order's fill that throws", () => {
  it("is a skip, fill_failed, told once; its intent is cancelled and an exit tries again", async () => {
    const fault = { isArmed: false };
    const test = await startFillEngine({ intents: (store) => failingAtQuote(store, fault) });
    const order = await activeOrder(test, testStopLoss());
    fault.isArmed = true;
    const fill = async () => test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    const outcomes = [await fill(), await fill()];

    const intents = await fillIntentsOf(test);
    expect(outcomes).toStrictEqual(["skipped", "skipped"]);
    expect(intents.map(({ state }) => state)).toStrictEqual(["cancelled", "cancelled"]);
    expect(await fillRowsOf(test, order.id)).toMatchObject([
      { outcome: "skipped", reason: "fill_failed", intentId: intents[1]?.id },
      { outcome: "skipped", reason: "fill_failed", intentId: intents[0]?.id },
    ]);
    expect(noticesOf(test)).toMatchObject([
      { key: "notice.skipped", parts: { reason: { key: "reason.fill_failed" } } },
    ]);
  });

  it("makes a buy wait before it tries again, as any skip does", async () => {
    const fault = { isArmed: false };
    const test = await startFillEngine({ intents: (store) => failingAtQuote(store, fault) });
    const order = await activeOrder(test, limitBuy);
    fault.isArmed = true;
    const fill = async () => test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    expect([await fill(), await fill()]).toStrictEqual(["skipped", "waiting"]);
  });
});
