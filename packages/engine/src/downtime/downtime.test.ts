import { bpsSchema, type JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent, testToken } from "../intents/test-intents.js";
import type { TestEngine } from "../operations/test-engine.js";
import type { WatchedOrderPrice } from "../orders/order-triggers.js";
import {
  activeOrder,
  fillRowsOf,
  noticesOf,
  startFillEngine,
  wholeToken,
} from "../orders/test-fills.js";
import { storedOrder, testStopLoss } from "../orders/test-orders.js";
import { noticeSchema } from "../pushes/notice-push.js";

const live = { signal: new AbortController().signal };
const minuteMs = 60_000;
const hourMs = 60 * minuteMs;

// The test token at `micros` micro-dollars a whole token, read at `readAtMs`.
function at(micros: bigint, readAtMs: number): WatchedOrderPrice {
  return {
    token: testToken,
    usdPerBaseUnit: { numerator: micros, denominator: wholeToken },
    decimals: 6,
    isThin: false,
    readAtMs,
  };
}

// A stop-loss that fires on half the position, one that fires but whose quote breaks its worst
// price, and a take-profit whose trigger the price after the downtime does not reach.
async function threeOrders(test: TestEngine) {
  const stop = await activeOrder(
    test,
    testStopLoss({ size: { percentBps: bpsSchema.parse(5_000) } }),
  );
  const bounded = await activeOrder(test, testStopLoss({ worstPrice: 1n }));
  const profit = await activeOrder(test, {
    ...testStopLoss(),
    kind: "takeProfit",
    trigger: { price: 2_000_000n },
  });
  return { stop, bounded, profit };
}

function keysOf(notices: readonly JsonValue[]): readonly string[] {
  return notices.map((notice) => noticeSchema.parse(notice).key);
}

function resumedOf(test: TestEngine): readonly JsonValue[] {
  return noticesOf(test).filter((notice) => keysOf([notice])[0] === "notice.resumed");
}

// The agent's resume reports, as the inbox stored them.
async function reportsOf(test: TestEngine): Promise<readonly JsonValue[]> {
  const query = { agentId: testAgent, limit: 50 };
  const untaken = await test.stores.agentInbox.untaken(query, live);
  return untaken.filter(({ kind }) => kind === "inbox/resumeReport").map(({ payload }) => payload);
}

describe("the downtime re-check", () => {
  it("re-checks each price order at a start on the first price read after it, and reports once", async () => {
    const test = await startFillEngine({ tokens: 2n * wholeToken });
    const { stop, bounded, profit } = await threeOrders(test);
    await test.engine.downtime.alive(live);
    const stoppedAtMs = test.clock.now();
    await test.clock.advance(3 * hourMs);

    const restarted = test.restart();
    const run = await restarted.downtime.started(live);
    const stale = await restarted.seePrice(at(700_000n, stoppedAtMs), live);
    const fresh = await restarted.seePrice(at(700_000n, test.clock.now()), live);
    await test.clock.advance(20_000);
    const report = await run?.reported;

    expect(stale).toStrictEqual([]);
    expect(fresh).toStrictEqual([
      { order: stop.id, outcome: "filled" },
      { order: bounded.id, outcome: "skipped" },
    ]);
    const byOrder = new Map(report?.orders.map((checked) => [checked.order, checked]));
    expect(report?.orders).toHaveLength(3);
    expect(byOrder.get(stop.id)).toStrictEqual({
      order: stop.id,
      agentId: testAgent,
      kind: "stopLoss",
      outcome: "filled",
    });
    expect(byOrder.get(bounded.id)).toStrictEqual({
      order: bounded.id,
      agentId: testAgent,
      kind: "stopLoss",
      outcome: "skipped",
      reason: "worst_price",
      reasonPart: { key: "reason.worst_price", values: {} },
    });
    expect(byOrder.get(profit.id)).toStrictEqual({
      order: profit.id,
      agentId: testAgent,
      kind: "takeProfit",
      outcome: "skipped",
      reason: "trigger_not_met",
    });
    expect(resumedOf(test)).toMatchObject([
      { values: { cause: "start", checked: "3", filled: "1", skipped: "2" } },
    ]);
    // The skip lives in its row, told in the report alone; the fill keeps its own notice.
    expect(keysOf(noticesOf(test))).not.toContain("notice.skipped");
    expect(keysOf(noticesOf(test))).toContain("notice.fill");
    expect(await fillRowsOf(test, bounded.id)).toMatchObject([
      { outcome: "skipped", reason: "worst_price" },
    ]);
    expect(await storedOrder(test, profit.id)).toMatchObject({ state: "active", fills: 0 });
    expect(await reportsOf(test)).toMatchObject([
      { cause: "start", offMs: 3 * hourMs, checked: 3, filled: 1, skipped: 2 },
    ]);
  });

  it("stays silent after a resume that checked no order, and marks the engine alive", async () => {
    const test = await startFillEngine();
    await test.engine.downtime.alive(live);
    await test.clock.advance(hourMs);

    const restarted = test.restart();
    const run = await restarted.downtime.started(live);
    const stale = await restarted.seePrice(at(700_000n, test.clock.now() - hourMs), live);
    await test.clock.advance(20_000);
    const report = await run?.reported;

    expect(report).toMatchObject({ cause: "start", offMs: hourMs, orders: [] });
    expect(stale).toStrictEqual([]);
    expect(resumedOf(test)).toStrictEqual([]);
    expect(await reportsOf(test)).toStrictEqual([]);
    await expect(test.stores.alive.lastAlive(live)).resolves.toBe(test.clock.now());
  });

  it("re-checks the orders the same way after a sleep found while the engine runs", async () => {
    const test = await startFillEngine({ tokens: 2n * wholeToken });
    const { stop, bounded, profit } = await threeOrders(test);
    const asleepFromMs = test.clock.now();
    await test.clock.advance(10 * minuteMs);

    const run = await test.engine.downtime.woke(asleepFromMs, live);
    const stale = await test.engine.seePrice(at(700_000n, asleepFromMs), live);
    await test.engine.seePrice(at(700_000n, test.clock.now()), live);
    await test.clock.advance(20_000);
    const report = await run.reported;

    expect(stale).toStrictEqual([]);
    expect(report.cause).toBe("wake");
    const outcomes = new Map(report.orders.map(({ order, outcome }) => [order, outcome]));
    expect([
      outcomes.get(stop.id),
      outcomes.get(bounded.id),
      outcomes.get(profit.id),
    ]).toStrictEqual(["filled", "skipped", "skipped"]);
    expect(resumedOf(test)).toMatchObject([
      {
        values: { cause: "wake", checked: "3", filled: "1", skipped: "2" },
        parts: { duration: { key: "pnl.minutes", values: { count: "10" } } },
      },
    ]);
  });
});
