import { bpsSchema } from "@binference/core";
import type { IntentRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testToken, testWallet } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { activeOrder, eightyCents, fillRowsOf, noticesOf, startFillEngine } from "./test-fills.js";
import { storedOrder, tapCard, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

const sellAll: IntentRequest = {
  kind: "sell",
  agent: testAgent,
  wallet: testWallet,
  token: testToken,
  amount: { percentBps: bpsSchema.parse(10_000) },
  reason: "Sell all of it by hand",
};

describe("an exit order on a position that holds none of its token", () => {
  it("waits, skipped as nothing_to_sell, when the position was never held, as before a buy settles", async () => {
    const test = await startFillEngine({ tokens: 0n });
    const order = await activeOrder(test, testStopLoss());

    const outcome = await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    expect(outcome).toBe("skipped");
    expect((await storedOrder(test, order.id)).state).toBe("active");
    expect(await fillRowsOf(test, order.id)).toMatchObject([{ reason: "nothing_to_sell" }]);
    expect(noticesOf(test)).toMatchObject([
      { key: "notice.skipped", parts: { reason: { key: "reason.nothing_to_sell" } } },
    ]);
  });

  it("ends when a sale outside the exit orders emptied the position after the order was made", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, testStopLoss());
    const sold = expectOk(await test.engine.handlers["intent/propose"](testCall(sellAll)));
    await tapCard(test, sold.intent, "confirm");

    const outcome = await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    expect(outcome).toBe("ended");
    expect(await storedOrder(test, order.id)).toMatchObject({
      state: "ended",
      endReason: "position_closed",
    });
    expect(noticesOf(test)).toMatchObject([{ key: "notice.exitEnded" }]);
  });

  it("skips as balance_unread, never ends, when a live balance read has no entry for the token", async () => {
    const test = await startFillEngine({
      agent: { mode: "live" },
      liveOrderFills: true,
      walletFacts: (source) => ({ ...source, balances: async () => Promise.resolve([]) }),
    });
    const order = await activeOrder(test, testStopLoss());

    const outcome = await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    expect(outcome).toBe("skipped");
    expect((await storedOrder(test, order.id)).state).toBe("active");
    expect(await fillRowsOf(test, order.id)).toMatchObject([{ reason: "balance_unread" }]);
  });
});
