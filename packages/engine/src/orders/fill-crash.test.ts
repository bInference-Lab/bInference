import { describe, expect, it } from "vitest";
import type { IntentChange } from "../intents/intent-change.js";
import { testLimits, testToken } from "../intents/test-intents.js";
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

const isRefused = (change: IntentChange): boolean => change.state === "rejected_policy";
// The fill's own confirmation, which carries no card.
const isFillConfirmed = (change: IntentChange): boolean =>
  change.state === "confirmed" && change.confirmation === undefined;

// An intent store that stops the run, as a crash does, right after the move `stopsAfter` picks
// commits: every later call of the run finds its signal aborted.
function stoppingAfter(
  store: IntentStore,
  stop: { readonly controller: AbortController; readonly after: (change: IntentChange) => boolean },
): IntentStore {
  return {
    ...store,
    transition: async (change, call) => {
      const moved = await store.transition(change, call);
      if (stop.after(change)) {
        stop.controller.abort();
      }
      return moved;
    },
  };
}

describe("an auto order's fill stopped by a crash", () => {
  it("keeps a skip's row and notice with its intent's end, and tells the owner at the next start", async () => {
    const controller = new AbortController();
    const test = await startFillEngine({
      agent: { limits: { ...testLimits, denyTokens: [testToken] } },
      intents: (store) => stoppingAfter(store, { controller, after: isRefused }),
    });
    const order = await activeOrder(test, testStopLoss());

    const run = test.engine.fillOrder(
      { order: order.id, price: eightyCents },
      { signal: controller.signal },
    );
    const stopped = await run.then(
      () => "ran",
      () => "stopped",
    );
    const [ended] = await fillIntentsOf(test);

    expect([stopped, noticesOf(test)]).toStrictEqual(["stopped", []]);
    expect(await fillRowsOf(test, order.id)).toMatchObject([
      { outcome: "skipped", reason: "token_denied", intentId: ended?.id },
    ]);
    await test.restart().repairOrderFills(live);
    await test.restart().repairOrderFills(live);
    expect(noticesOf(test)).toMatchObject([
      { key: "notice.skipped", parts: { reason: { key: "reason.token_denied" } } },
    ]);
  });

  it("cancels at the next start a paper fill a stop left confirmed", async () => {
    const controller = new AbortController();
    const test = await startFillEngine({
      intents: (store) => stoppingAfter(store, { controller, after: isFillConfirmed }),
    });
    const order = await activeOrder(test, testStopLoss());

    await test.engine
      .fillOrder({ order: order.id, price: eightyCents }, { signal: controller.signal })
      .catch(() => "stopped");
    const left = (await test.stores.intents.list({ states: ["confirmed"], limit: 5 }, live)).filter(
      ({ proposer }) => proposer === "engine",
    );
    await test.restart().repairOrderFills(live);

    expect(left).toHaveLength(1);
    expect(await fillIntentsOf(test)).toMatchObject([{ id: left[0]?.id, state: "cancelled" }]);
  });
});
