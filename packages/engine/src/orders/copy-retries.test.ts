import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testToken } from "../intents/test-intents.js";
import { copyStateNow, leaderTrade, storeTrades } from "./test-copies.js";
import {
  activeOrder,
  fillIntentsOf,
  fillPrices,
  fillRowsOf,
  startFillEngine,
} from "./test-fills.js";
import { testCopy } from "./test-orders.js";

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
async function bought() {
  const lock = { isLocked: false };
  const test = await startFillEngine({ prices, isLocked: () => lock.isLocked });
  const order = await activeOrder(test, testCopy());
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
