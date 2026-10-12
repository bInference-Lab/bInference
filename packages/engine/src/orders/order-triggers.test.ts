import { assetRefSchema } from "@binference/chain";
import { createFakeVenue } from "@binference/chain/testing";
import { bpsSchema, type Ratio } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testToken } from "../intents/test-intents.js";
import type { WatchedOrderPrice } from "./order-triggers.js";
import { triggerStateDocument } from "./price-triggers.js";
import { activeOrder, fillIntentsOf, startFillEngine, wholeToken } from "./test-fills.js";
import { storedOrder, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };
const otherToken = assetRefSchema.parse("fake:1/token:0x0000000b");

/** The test token at `micros` micro-dollars a whole token, from a deep pool or a thin one. */
function at(micros: bigint, isThin = false): WatchedOrderPrice {
  return {
    token: testToken,
    usdPerBaseUnit: { numerator: micros, denominator: wholeToken },
    decimals: 6,
    isThin,
  };
}

const trailingStop = {
  ...testStopLoss(),
  kind: "trailing",
  trigger: { distanceBps: bpsSchema.parse(500) },
} as const;

// The peak an order keeps, in micro-dollars a whole token, rounded down.
function peakMicros(state: Parameters<typeof triggerStateDocument.decode>[0] | undefined): bigint {
  const peak: Ratio = triggerStateDocument.decode(state ?? null).peak ?? at(0n).usdPerBaseUnit;
  return peak.numerator / peak.denominator;
}

describe("price triggers", () => {
  it("fill a stop-loss at or below its price, and nothing above it", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, testStopLoss());

    const above = await test.engine.seePrice(at(800_001n), live);
    const atStop = await test.engine.seePrice(at(800_000n), live);

    expect(above).toStrictEqual([]);
    expect(atStop).toStrictEqual([{ order: order.id, outcome: "filled" }]);
    expect((await storedOrder(test, order.id)).state).toBe("filled");
  });

  it("fill a limit buy at or below its price, and judge no order of another token", async () => {
    const test = await startFillEngine();
    const buy = await activeOrder(test, {
      ...testStopLoss(),
      kind: "limit",
      side: "buy",
      size: { base: 10n ** 15n },
      trigger: { price: 500_000n, direction: "below" },
    });

    const elsewhere = await test.engine.seePrice({ ...at(1n), token: otherToken }, live);
    const above = await test.engine.seePrice(at(500_001n), live);
    const below = await test.engine.seePrice(at(400_000n), live);

    expect([elsewhere, above]).toStrictEqual([[], []]);
    expect(below).toStrictEqual([{ order: buy.id, outcome: "filled" }]);
  });

  it("keep a trailing stop's highest price in its order and fill on the drop past its distance", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, trailingStop);

    await test.engine.seePrice(at(1_000_000n), live);
    const first = peakMicros((await storedOrder(test, order.id)).triggerState);
    await test.engine.seePrice(at(1_200_000n), live);
    const held = await test.engine.seePrice(at(1_140_001n), live);
    const second = peakMicros((await storedOrder(test, order.id)).triggerState);
    const dropped = await test.engine.seePrice(at(1_140_000n), live);

    expect([first, second]).toStrictEqual([1_000_000n, 1_200_000n]);
    expect(held).toStrictEqual([]);
    expect(dropped).toStrictEqual([{ order: order.id, outcome: "filled" }]);
  });

  it("judge a burst of prices of one token in order, keeping the highest and firing on the drop", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, {
      ...trailingStop,
      trigger: { distanceBps: bpsSchema.parse(1_000) },
    });
    await test.engine.seePrice(at(1_000_000n), live);

    const burst = await Promise.all(
      [1_100_000n, 1_200_000n, 1_150_000n, 1_050_000n].map(async (micros) =>
        test.engine.seePrice(at(micros), live),
      ),
    );

    expect(burst.map((outcomes) => outcomes.map(({ outcome }) => outcome))).toStrictEqual([
      [],
      [],
      [],
      ["filled"],
    ]);
    expect(await storedOrder(test, order.id)).toMatchObject({ state: "filled", fills: 1 });
  });

  it("keep a trailing stop's highest price across a restart", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, trailingStop);
    await test.engine.seePrice(at(1_200_000n), live);

    const restarted = test.restart();
    const held = await restarted.seePrice(at(1_150_000n), live);
    const dropped = await restarted.seePrice(at(1_140_000n), live);

    expect(peakMicros((await storedOrder(test, order.id)).triggerState)).toBe(1_200_000n);
    expect(held).toStrictEqual([]);
    expect(dropped).toStrictEqual([{ order: order.id, outcome: "filled" }]);
  });

  it("fill a stop-loss on a thin pool's price only when the fill's own quote meets it too", async () => {
    // A venue that pays $1.20 a token: above the stop, so only a deep pool's price fills it.
    const dollarTwenty = createFakeVenue({ rate: { numerator: 2n * 10n ** 9n, denominator: 1n } });
    const test = await startFillEngine({ venues: [dollarTwenty] });
    const stop = await activeOrder(test, testStopLoss());

    const thin = await test.engine.seePrice(at(800_000n, true), live);
    const deep = await test.engine.seePrice(at(800_000n), live);

    expect([thin, deep]).toStrictEqual([
      [{ order: stop.id, outcome: "skipped" }],
      [{ order: stop.id, outcome: "filled" }],
    ]);
    const ended = (await fillIntentsOf(test)).map(
      ({ state, reason }) => `${state} ${String(reason)}`,
    );
    expect(ended.toSorted()).toStrictEqual([
      "failed_check trigger_unconfirmed",
      "paper_filled undefined",
    ]);
  });
});
