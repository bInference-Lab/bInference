import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testToken } from "../intents/test-intents.js";
import type { TestEngineOptions } from "../operations/test-engine.js";
import { copyStateNow, leaderTrade, storeTrades } from "./test-copies.js";
import {
  activeOrder,
  fillIntentsOf,
  fillPrices,
  fillRowsOf,
  startFillEngine,
} from "./test-fills.js";
import { contendedOrders, storedOrder, testCopy } from "./test-orders.js";

const live = { signal: new AbortController().signal };
// The fake venue pays two base units for one, so the token's price keeps a copy's sale small.
const prices = new Map(fillPrices).set(testToken, { numerator: 1n, denominator: 10n ** 9n });
const share = bpsSchema.parse(5_000);

function outcomes(rows: Awaited<ReturnType<typeof fillRowsOf>>) {
  return rows.map(({ outcome, reason }) =>
    reason === undefined ? outcome : `${outcome}:${reason}`,
  );
}

// A paper engine whose lock a test turns, with an active copy order that bought the token.
async function bought(options: Pick<TestEngineOptions, "orders"> = {}, request = testCopy()) {
  const lock = { isLocked: false };
  const test = await startFillEngine({ ...options, prices, isLocked: () => lock.isLocked });
  const order = await activeOrder(test, request);
  await storeTrades(test, [leaderTrade(1, { side: "buy", atMs: test.clock.now() })]);
  await test.engine.runCopies(live);
  return { test, order, lock };
}

describe("a copy order's mirrored sale that fails for a passing reason", () => {
  it("is sold again a minute later, once", async () => {
    const { test, order, lock } = await bought();
    lock.isLocked = true;
    const atMs = test.clock.now();
    await storeTrades(test, [leaderTrade(2, { side: "sell", atMs, shareSoldBps: share })]);
    await test.engine.runCopies(live);
    lock.isLocked = false;
    await test.engine.runCopies(live);
    const early = outcomes(await fillRowsOf(test, order.id));

    await test.clock.advance(60_000);
    await test.engine.runCopies(live);
    await test.clock.advance(60_000);
    await test.engine.runCopies(live);

    expect(early).toStrictEqual(["skipped:engine_locked", "filled"]);
    const rows = await fillRowsOf(test, order.id);
    expect(outcomes(rows)).toStrictEqual(["filled", "skipped:engine_locked", "filled"]);
    expect(rows.map(({ copy }) => copy?.trade)).toStrictEqual([2, 2, 1]);
    const sales = (await fillIntentsOf(test)).filter(({ kind }) => kind === "sell");
    expect(sales).toHaveLength(1);
    expect((await copyStateNow(test, order.id)).retries).toStrictEqual([]);
  });

  it("fills the order when the sale sold again uses its last fill, and reads nothing after", async () => {
    const { test, order, lock } = await bought({}, testCopy({ maxFills: 2 }));
    lock.isLocked = true;
    const atMs = test.clock.now();
    await storeTrades(test, [leaderTrade(2, { side: "sell", atMs, shareSoldBps: share })]);
    await test.engine.runCopies(live);
    lock.isLocked = false;

    await test.clock.advance(60_000);
    await test.engine.runCopies(live);

    const rows = await fillRowsOf(test, order.id);
    expect(outcomes(rows)).toStrictEqual(["filled", "skipped:engine_locked", "filled"]);
    expect((await storedOrder(test, order.id)).state).toBe("filled");
  });

  it("is given up an hour after the leader's sale, with a notice", async () => {
    const { test, order, lock } = await bought();
    lock.isLocked = true;
    const atMs = test.clock.now();
    await storeTrades(test, [leaderTrade(2, { side: "sell", atMs, shareSoldBps: share })]);
    await test.engine.runCopies(live);
    await test.clock.advance(3_600_001);

    await test.engine.runCopies(live);
    await test.engine.runCopies(live);

    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual([
      "skipped:copy_sale_lapsed",
      "skipped:engine_locked",
      "filled",
    ]);
    expect((await copyStateNow(test, order.id)).retries).toStrictEqual([]);
  });

  it("is given up once when another write beat the write that gave it up", async () => {
    const armed = { isOn: false };
    const race = contendedOrders(1, () => armed.isOn);
    const { test, order, lock } = await bought({ orders: race.orders });
    lock.isLocked = true;
    const atMs = test.clock.now();
    await storeTrades(test, [leaderTrade(2, { side: "sell", atMs, shareSoldBps: share })]);
    await test.engine.runCopies(live);
    await test.clock.advance(3_600_001);
    armed.isOn = true;

    await test.engine.runCopies(live);

    expect(race.raced()).toBe(1);
    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual([
      "skipped:copy_sale_lapsed",
      "skipped:engine_locked",
      "filled",
    ]);
    expect((await copyStateNow(test, order.id)).retries).toStrictEqual([]);
  });

  it("is given up at once while fifty sales already wait to be sold again", async () => {
    const { test, order, lock } = await bought();
    lock.isLocked = true;
    const trades = Array.from({ length: 51 }, (_, n) => n + 2);
    for (const trade of trades) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one leader sale a run, in order
      await storeTrades(test, [
        leaderTrade(trade, { side: "sell", atMs: test.clock.now(), shareSoldBps: share }),
      ]);
      // oxlint-disable-next-line eslint/no-await-in-loop -- one leader sale a run, in order
      await test.engine.runCopies(live);
      // oxlint-disable-next-line eslint/no-await-in-loop -- one leader sale a run, in order
      await test.clock.advance(1);
    }

    const rows = await test.stores.orders.fills({ orderId: order.id, limit: 100 }, live);
    const reasons = outcomes(rows);
    // The last sale's two rows share one instant, so their order is not kept.
    expect(rows.slice(0, 2).map(({ copy }) => copy?.trade)).toStrictEqual([52, 52]);
    expect(reasons.slice(0, 2).toSorted()).toStrictEqual([
      "skipped:copy_sale_lapsed",
      "skipped:engine_locked",
    ]);
    expect(reasons.filter((reason) => reason === "skipped:engine_locked")).toHaveLength(51);
    const { retries } = await copyStateNow(test, order.id);
    expect(retries.map(({ id }) => id)).toStrictEqual(trades.slice(0, 50));
  });

  it("never comes back for a buy", async () => {
    const { test, order, lock } = await bought();
    lock.isLocked = true;
    await storeTrades(test, [leaderTrade(2, { side: "buy", atMs: test.clock.now() })]);
    await test.engine.runCopies(live);
    lock.isLocked = false;
    await test.clock.advance(60_000);

    await test.engine.runCopies(live);

    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual([
      "skipped:engine_locked",
      "filled",
    ]);
  });
});
