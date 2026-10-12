import { createFakeVenue } from "@binference/chain/testing";
import { bpsSchema, type Id, idSchema, type JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent, testLimits, testNowMs, testToken } from "../intents/test-intents.js";
import type { TestEngine } from "../operations/test-engine.js";
import type { IntentStore } from "../ports.js";
import {
  activeOrder,
  eightyCents,
  fillIntentsOf,
  fillRowsOf,
  noticesOf,
  startFillEngine,
} from "./test-fills.js";
import { storedOrder, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };
// Another intent of the agent, confirmed by a tap the fill's policy step did not see.
const other = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-0000000000ff");

// The states the order pushes carried, oldest first.
function orderStatesOf(test: TestEngine): readonly JsonValue[] {
  return test.pushes
    .filter(({ topic, kind }) => topic === "order" && kind === "order/changed")
    .map(({ data }) => (isRecord(data) ? (data["state"] ?? null) : null));
}

function isRecord(data: JsonValue): data is Readonly<Record<string, JsonValue>> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

// An intent id a row must carry.
function idOf(intent: Id<"int"> | undefined): Id<"int"> {
  if (intent === undefined) {
    throw new Error("Expected the fill row to name its intent.");
  }
  return intent;
}

// An intent store whose fill's own confirmation, which carries no card, moves the clock a minute
// on, past the order's expiry, before the paper fill.
function passingExpiryAtFill(
  store: IntentStore,
  holder: { readonly test?: TestEngine },
): IntentStore {
  return {
    ...store,
    transition: async (change, call) => {
      const moved = await store.transition(change, call);
      if (change.state === "confirmed" && change.confirmation === undefined) {
        await holder.test?.clock.advance(60_000);
      }
      return moved;
    },
  };
}

const takeProfit = { ...testStopLoss(), kind: "takeProfit", trigger: { price: 700_000n } } as const;

describe("an auto order's fill", () => {
  it("sells on paper at its trigger with no card, records the fill on its order and tells the owner", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, testStopLoss());

    const outcome = await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    const [intent] = await fillIntentsOf(test);
    const [row] = await fillRowsOf(test, order.id);
    expect(outcome).toBe("filled");
    expect(intent).toMatchObject({ kind: "sell", state: "paper_filled", isPaper: true });
    expect(await test.stores.intents.cards(idOf(row?.intentId), live)).toStrictEqual([]);
    expect(await storedOrder(test, order.id)).toMatchObject({ state: "filled", fills: 1 });
    expect(row).toMatchObject({ outcome: "filled", intentId: intent?.id });
    expect(noticesOf(test)).toMatchObject([
      {
        key: "notice.fill",
        agent: testAgent,
        values: { mode: "paper" },
        parts: {
          orderKind: { key: "order.kind", values: { kind: "stopLoss" } },
          result: { key: "fill.sell" },
        },
      },
    ]);
    expect(orderStatesOf(test).at(-1)).toBe("filled");
  });

  it("skips a live order while live fills are off, keeps it active and says so once", async () => {
    // Made while live fills were on, then the engine starts again with them off.
    const test = await startFillEngine({ agent: { mode: "live" }, liveOrderFills: true });
    const order = await activeOrder(test, testStopLoss());
    const engine = test.restart({ liveOrderFills: false });
    const fill = async () => engine.fillOrder({ order: order.id, price: eightyCents }, live);

    // An exit order tries again at the next price, and the owner hears the reason once.
    const outcomes = [await fill(), await fill(), await fill()];

    expect(outcomes).toStrictEqual(["skipped", "skipped", "skipped"]);
    expect((await storedOrder(test, order.id)).state).toBe("active");
    expect(await fillIntentsOf(test)).toStrictEqual([]);
    expect((await fillRowsOf(test, order.id)).map(({ reason }) => reason)).toStrictEqual([
      "live_fills_off",
      "live_fills_off",
      "live_fills_off",
    ]);
    expect(noticesOf(test)).toStrictEqual([
      {
        key: "notice.skipped",
        agent: testAgent,
        values: {},
        parts: {
          orderKind: { key: "order.kind", values: { kind: "stopLoss" } },
          reason: { key: "reason.live_fills_off", values: {} },
        },
      },
    ]);
  });

  it("fills nothing while the engine is locked, paper or not, and tells the owner", async () => {
    const test = await startFillEngine({ isLocked: () => true });
    const order = await activeOrder(test, testStopLoss());

    const outcome = await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    expect(outcome).toBe("skipped");
    expect(await fillIntentsOf(test)).toStrictEqual([]);
    expect((await storedOrder(test, order.id)).state).toBe("active");
    expect(noticesOf(test)).toMatchObject([
      { key: "notice.skipped", parts: { reason: { key: "reason.engine_locked" } } },
    ]);
  });

  it("ends a sale whose quote is worse than the order's worst price, and keeps the order", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, testStopLoss({ worstPrice: 1n }));

    const outcome = await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    const [intent] = await fillIntentsOf(test);
    expect(outcome).toBe("skipped");
    expect(intent).toMatchObject({ state: "failed_check", reason: "worst_price" });
    expect(await storedOrder(test, order.id)).toMatchObject({ state: "active", fills: 0 });
    expect(await fillRowsOf(test, order.id)).toMatchObject([
      { outcome: "skipped", reason: "worst_price", intentId: intent?.id },
    ]);
  });

  it("ends a fill whose rolling cap another confirmation took after its policy step", async () => {
    const cap = testLimits.rollingDayUsdMicros;
    const test = await startFillEngine({
      intents: (store) => ({
        ...store,
        confirmedSince: async () => [
          { intentId: other, state: "confirmed", confirmedAtMs: testNowMs, valueUsdMicros: cap },
        ],
      }),
    });
    const order = await activeOrder(test, testStopLoss());

    await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    expect(await fillIntentsOf(test)).toMatchObject([
      { state: "failed_check", reason: "daily_cap" },
    ]);
    expect(noticesOf(test)).toMatchObject([
      {
        key: "notice.skipped",
        parts: { reason: { key: "reason.daily_cap", values: { cap: "$5,000.00" } } },
      },
    ]);
  });

  it("refuses a sale of a token on the deny list, which only the owner's tap may sell", async () => {
    const test = await startFillEngine({
      agent: { limits: { ...testLimits, denyTokens: [testToken] } },
    });
    const order = await activeOrder(test, testStopLoss());

    await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    expect(await fillIntentsOf(test)).toMatchObject([
      { state: "rejected_policy", reason: "token_denied" },
    ]);
  });

  it("ends an exit order whose position holds none of the token, instead of skipping it", async () => {
    const test = await startFillEngine({ tokens: 0n });
    const order = await activeOrder(test, testStopLoss());

    const outcome = await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    expect(outcome).toBe("ended");
    expect(await storedOrder(test, order.id)).toMatchObject({
      state: "ended",
      endReason: "position_closed",
    });
    expect(noticesOf(test)).toMatchObject([{ key: "notice.exitEnded" }]);
  });

  it("ends the position's other exit orders in the fill's own write when it sells all", async () => {
    // A venue that pays $1.20 a token, so the take-profit's own quote meets its $0.70 level.
    const dollarTwenty = createFakeVenue({ rate: { numerator: 2n * 10n ** 9n, denominator: 1n } });
    const test = await startFillEngine({ venues: [dollarTwenty] });
    const profit = await activeOrder(test, takeProfit);
    const stop = await activeOrder(test, testStopLoss());

    await test.engine.fillOrder({ order: profit.id, price: eightyCents }, live);

    expect((await storedOrder(test, stop.id)).state).toBe("ended");
    expect(noticesOf(test)).toMatchObject([
      { key: "notice.ordersEnded", values: { token: "TKN", count: "1" } },
      { key: "notice.fill" },
    ]);
    await expect(test.engine.fillOrder({ order: stop.id, price: eightyCents }, live)).resolves.toBe(
      "inactive",
    );
  });

  it("buys with the coin by amount on paper, and skips a buy in dollars nothing can price", async () => {
    const buy = {
      ...testStopLoss(),
      kind: "limit",
      side: "buy",
      size: { base: 10n ** 15n },
      trigger: { price: 900_000n, direction: "below" },
      maxSlippageBps: bpsSchema.parse(50),
    } as const;
    const test = await startFillEngine();
    const byAmount = await activeOrder(test, buy);
    await test.engine.fillOrder({ order: byAmount.id, price: eightyCents }, live);
    const unpriced = await startFillEngine({
      prices: new Map([[testToken, eightyCents.usdPerBaseUnit]]),
    });
    const inDollars = await activeOrder(unpriced, { ...buy, size: { usdMicros: 5_000_000n } });
    await unpriced.engine.fillOrder({ order: inDollars.id, price: eightyCents }, live);

    expect(await fillIntentsOf(test)).toMatchObject([{ kind: "buy", state: "paper_filled" }]);
    expect(await fillRowsOf(unpriced, inDollars.id)).toMatchObject([{ reason: "no_price" }]);
  });

  it("cancels a confirmed fill unsigned when its order expired before the fill could record it", async () => {
    const holder: { test?: TestEngine } = {};
    const test = await startFillEngine({ intents: (store) => passingExpiryAtFill(store, holder) });
    holder.test = test;
    const order = await activeOrder(test, testStopLoss({ expiresAt: testNowMs + 30_000 }));

    const outcome = await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    expect(outcome).toBe("inactive");
    expect(await fillIntentsOf(test)).toMatchObject([{ state: "cancelled" }]);
    expect(await storedOrder(test, order.id)).toMatchObject({ fills: 0 });
    expect(await fillRowsOf(test, order.id)).toStrictEqual([]);
  });

  it("fills nothing for an order that is not active, or past its expiry", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, testStopLoss({ expiresAt: testNowMs + 60_000 }));
    await test.clock.advance(60_000);

    await expect(
      test.engine.fillOrder({ order: order.id, price: eightyCents }, live),
    ).resolves.toBe("inactive");
    expect(await fillIntentsOf(test)).toStrictEqual([]);
  });
});
