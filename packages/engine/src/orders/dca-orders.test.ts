import { BinferenceError } from "@binference/core";
import type { ManualClock } from "@binference/core/testing";
import type { DcaOrderRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createQuoteSimulator } from "../fakes/quote-simulator.js";
import { expectOk, testAgent, testNowMs, testToken } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import type { Simulator } from "../ports.js";
import { dcaPeriodDocument } from "./dca-period.js";
import { moveOrder } from "./order-machine.js";
import type { OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";
import { activeOrder, fillIntentsOf, fillRowsOf, startFillEngine } from "./test-fills.js";
import { storedOrder } from "./test-orders.js";

const live = { signal: new AbortController().signal };
const minuteMs = 60_000;
// The test clock starts at 08:00 UTC; the order buys at 08:05, 08:10 and 08:15.
const firstAt = testNowMs + 5 * minuteMs;

const dca: DcaOrderRequest = {
  kind: "dca",
  agent: testAgent,
  token: testToken,
  side: "buy",
  size: { usdMicros: 10_000_000n },
  trigger: { cron: "*/5 * * * *", count: 3 },
  reason: "Buy a little every five minutes",
};

// The order store, refusing every move of the order `broken` names as a store fault.
function failingMoves(store: OrderStore, broken: { readonly id?: string }): OrderStore {
  return {
    ...store,
    move: async (moves, call) =>
      moves.some(({ id }) => id === broken.id)
        ? Promise.reject(new BinferenceError({ code: "store.down", message: "down" }))
        : store.move(moves, call),
  };
}

// A DCA order as if its zone no longer read.
function zoneGone(order: OrderRecord): OrderRecord {
  const trigger = { cron: "*/5 * * * *", timezone: "Mars/Base" };
  return order.request.kind === "dca"
    ? { ...order, request: { ...order.request, trigger } }
    : order;
}

// The order store, answering every DCA order as if its zone no longer read.
function zonesGone(store: OrderStore): OrderStore {
  return { ...store, list: async (query, call) => (await store.list(query, call)).map(zoneGone) };
}

function outcomes(rows: Awaited<ReturnType<typeof fillRowsOf>>) {
  return rows.map(({ outcome, reason }) =>
    reason === undefined ? outcome : `${outcome}:${reason}`,
  );
}

describe("a DCA order", () => {
  it("buys once per period on the owner's clock, and fills after its count", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, dca);
    await test.engine.runSchedules(live);
    expect((await storedOrder(test, order.id)).triggerState).toStrictEqual({ nextAtMs: firstAt });

    await test.clock.advance(5 * minuteMs);
    await test.engine.runSchedules(live);
    await test.engine.runSchedules(live);
    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["filled"]);

    await test.clock.advance(5 * minuteMs);
    await test.engine.runSchedules(live);
    await test.clock.advance(5 * minuteMs);
    await test.engine.runSchedules(live);

    const done = await storedOrder(test, order.id);
    expect([done.state, done.fills]).toStrictEqual(["filled", 3]);
    const buys = await fillIntentsOf(test);
    expect(buys.map(({ kind, state }) => [kind, state])).toStrictEqual([
      ["buy", "paper_filled"],
      ["buy", "paper_filled"],
      ["buy", "paper_filled"],
    ]);
  });

  it("skips the periods missed while the engine was off, records them, and never buys them later", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, dca);
    await test.engine.runSchedules(live);

    // Off from 08:00 to 08:22: the buys of 08:05, 08:10, 08:15 and 08:20 were due meanwhile.
    await test.clock.advance(22 * minuteMs);
    await test.engine.runSchedules(live);
    const after = await storedOrder(test, order.id);
    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["skipped:missed"]);
    expect([after.fills, after.triggerState]).toStrictEqual([
      0,
      { nextAtMs: firstAt + 20 * minuteMs },
    ]);
    expect(await fillIntentsOf(test)).toStrictEqual([]);

    await test.clock.advance(3 * minuteMs);
    await test.engine.runSchedules(live);
    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["filled", "skipped:missed"]);
  });

  it("buys nothing while its agent is frozen", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, dca);
    await test.engine.runSchedules(live);
    expectOk(await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent })));

    await test.clock.advance(5 * minuteMs);
    await test.engine.runSchedules(live);

    expect((await storedOrder(test, order.id)).state).toBe("paused");
    expect(await fillRowsOf(test, order.id)).toStrictEqual([]);
  });

  it("judges orders due together at the run's instant, and a buy that reaches its line late is late", async () => {
    // Each buy's simulation takes 25 seconds on the test clock: the fourth buy of the agent
    // reaches the head of its line past its period's minute.
    const slow: { clock?: ManualClock } = {};
    const quick = createQuoteSimulator(() => undefined);
    const simulator: Simulator = {
      async simulate(intent, built, options) {
        await slow.clock?.advance(25_000);
        return quick.simulate(intent, built, options);
      },
    };
    const test = await startFillEngine({ simulator });
    const orders = [
      await activeOrder(test, dca),
      await activeOrder(test, dca),
      await activeOrder(test, dca),
      await activeOrder(test, dca),
    ];
    await test.engine.runSchedules(live);
    await test.clock.advance(5 * minuteMs);
    slow.clock = test.clock;

    await test.engine.runSchedules(live);

    const rows = await Promise.all(
      orders.map(async ({ id }) => outcomes(await fillRowsOf(test, id))),
    );
    // The buys enter the agent's line in no set order: three in their minute, one late, none missed.
    expect(rows.flat().toSorted()).toStrictEqual(["filled", "filled", "filled", "skipped:late"]);
  });

  it("runs every other order when one order's period fails, then reports the failure", async () => {
    const broken: { id?: string } = {};
    const orders = (store: OrderStore): OrderStore => failingMoves(store, broken);
    const test = await startFillEngine({ orders });
    const failing = await activeOrder(test, dca);
    const working = await activeOrder(test, dca);
    broken.id = failing.id;
    await test.clock.advance(5 * minuteMs);

    await expect(test.engine.runSchedules(live)).rejects.toMatchObject({ code: "store.down" });
    await test.clock.advance(5 * minuteMs);
    await expect(test.engine.runSchedules(live)).rejects.toMatchObject({ code: "store.down" });

    expect(outcomes(await fillRowsOf(test, working.id))).toStrictEqual(["filled", "filled"]);
  });

  it("ends an order whose zone no longer reads, and tells the owner why", async () => {
    const test = await startFillEngine({ orders: zonesGone });
    const order = await activeOrder(test, dca);

    await test.engine.runSchedules(live);

    expect((await storedOrder(test, order.id)).state).toBe("cancelled");
    expect(await fillRowsOf(test, order.id)).toMatchObject([
      { reason: "period_unreadable", notices: [{ key: "notice.skipped" }] },
    ]);
  });

  it("records a period a stop cut off between keeping it and its buy as missed, once", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, dca);
    const kept = dcaPeriodDocument.encode({ nextAtMs: firstAt + 5 * minuteMs, buying: firstAt });
    const move = moveOrder(order, { type: "trigger_kept", triggerState: kept }, firstAt);
    await test.clock.advance(5 * minuteMs);
    await test.stores.orders.move([expectOk(move)], live);

    const restarted = test.restart();
    const repaired = await restarted.repairOrderFills(live);
    const again = await test.restart().repairOrderFills(live);

    expect([repaired, again]).toStrictEqual([1, 0]);
    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["skipped:missed"]);
    expect(await fillIntentsOf(test)).toStrictEqual([]);
  });
});
