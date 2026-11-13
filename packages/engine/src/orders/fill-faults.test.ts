import type { OrderRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { losingLeaseAt } from "../executor/test-lost-lease.js";
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
    const rows = await fillRowsOf(test, order.id);
    expect(rows).toMatchObject([
      { outcome: "skipped", reason: "fill_failed" },
      { outcome: "skipped", reason: "fill_failed" },
    ]);
    // Both fills ran in one instant, where the intents list by id and the rows as written.
    expect(new Set(rows.map(({ intentId }) => intentId))).toStrictEqual(
      new Set(intents.map(({ id }) => id)),
    );
    expect(noticesOf(test)).toMatchObject([
      { key: "notice.skipped", parts: { reason: { key: "reason.fill_failed" } } },
    ]);
  });

  it("throws a lost lease on, with no skip, no cancel and no notice after it", async () => {
    const writesAfter: string[] = [];
    const fault = { isArmed: false };
    const noteAfter = (state: string) => writesAfter.push(state);
    const loss = { state: "quoted", isArmed: () => fault.isArmed, noteAfter };
    const test = await startFillEngine({ intents: losingLeaseAt(loss) });
    const order = await activeOrder(test, testStopLoss());
    fault.isArmed = true;
    const filling = test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    await expect(filling).rejects.toMatchObject({ code: "store.lease_lost" });
    expect(writesAfter).toStrictEqual([]);
    expect(await fillRowsOf(test, order.id)).toStrictEqual([]);
    expect(await fillIntentsOf(test)).toStrictEqual([]);
    const left = await test.stores.intents.list({ states: ["checked"], limit: 5 }, live);
    expect(left.map(({ kind }) => kind)).toStrictEqual(["sell"]);
    expect(noticesOf(test)).toStrictEqual([]);
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
