import { createFakeVenue } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { TestEngine } from "../operations/test-engine.js";
import type { IntentStore } from "../ports.js";
import { activeOrder, eightyCents, startFillEngine } from "./test-fills.js";
import { createdOrder, storedOrder, tapCard, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

const takeProfit: OrderRequest = {
  ...testStopLoss(),
  kind: "takeProfit",
  trigger: { price: 700_000n },
};

/** The card the owner taps, once, while another fill is being written. */
interface LateTap {
  readonly arm: (test: TestEngine, intent: Id<"int">) => void;
  readonly take: () => { readonly test: TestEngine; readonly intent: Id<"int"> } | undefined;
}

function lateTapOf(): LateTap {
  const armed: { value?: { readonly test: TestEngine; readonly intent: Id<"int"> } } = {};
  return {
    arm: (test, intent) => {
      armed.value = { test, intent };
    },
    take: () => {
      const { value } = armed;
      delete armed.value;
      return value;
    },
  };
}

// An intent store that confirms a waiting exit order's card as a paper fill is written, after
// the fill read the position's other exit orders.
function tappingBeforeFill(store: IntentStore, late: LateTap): IntentStore {
  return {
    ...store,
    transition: async (change, call) => {
      const tap = change.state === "paper_filled" ? late.take() : undefined;
      if (tap !== undefined) {
        await tapCard(tap.test, tap.intent, "confirm");
      }
      return store.transition(change, call);
    },
  };
}

describe("an exit order made active while a fill emptied its position", () => {
  it("ends with position_closed after the fill, never left active on the empty position", async () => {
    // A venue that pays $1.20 a token, so the take-profit's own quote meets its $0.70 level.
    const dollarTwenty = createFakeVenue({ rate: { numerator: 2n * 10n ** 9n, denominator: 1n } });
    const late = lateTapOf();
    const test = await startFillEngine({
      venues: [dollarTwenty],
      intents: (store) => tappingBeforeFill(store, late),
    });
    const profit = await activeOrder(test, takeProfit);
    const waiting = await createdOrder(test, testStopLoss());
    late.arm(test, waiting.intent);

    await test.engine.fillOrder({ order: profit.id, price: eightyCents }, live);

    expect(await storedOrder(test, waiting.order)).toMatchObject({
      state: "ended",
      endReason: "position_closed",
    });
  });
});
