import { type Id, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { TestEngine } from "../operations/test-engine.js";
import { isWaiting } from "./fill-pacing.js";
import type { OrderFillRecord } from "./order-fill.js";
import { activeOrder, eightyCents, fillRowsOf, noticesOf, startFillEngine } from "./test-fills.js";
import { storedOrder, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

// A skip row of the order whose fill failed on chain, `reverted`, at `atMs`.
function revertedRow(order: Id<"ord">, n: number, atMs: number): OrderFillRecord {
  return {
    id: idSchema("fil").parse(`fil_0190f1c2-3a4b-7c5d-8e6f-${String(n).padStart(12, "0")}`),
    orderId: order,
    outcome: "skipped",
    reason: "reverted",
    atMs,
  };
}

async function revertsOf(test: TestEngine, order: Id<"ord">, count: number): Promise<void> {
  const rows = Array.from({ length: count }, (_, at) =>
    revertedRow(order, at + 1, test.clock.now() - 1),
  );
  // One at a time, as each failure is recorded.
  await rows.reduce(async (before, row) => {
    await before;
    await test.stores.orders.recordFill(row, live);
  }, Promise.resolve());
}

describe("an exit order whose fills fail on chain", () => {
  it("tries again at the next price after one failure, and backs off from the second", () => {
    const stop = { request: testStopLoss() };
    const order = idSchema("ord").parse("ord_0190f1c2-3a4b-7c5d-8e6f-000000000001");
    const one = [revertedRow(order, 1, 1_000)];
    const two = [revertedRow(order, 2, 1_000), revertedRow(order, 1, 900)];
    const three = [revertedRow(order, 3, 1_000), ...two];

    expect(isWaiting(stop, one, 1_001)).toBe(false);
    expect(isWaiting(stop, two, 1_000 + 14_999)).toBe(true);
    expect(isWaiting(stop, two, 1_000 + 15_000)).toBe(false);
    expect(isWaiting(stop, three, 1_000 + 29_999)).toBe(true);
  });

  it("stops after its fifth failure in a row, and tells the owner", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, testStopLoss());
    await revertsOf(test, order.id, 5);

    const outcome = await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    expect(outcome).toBe("ended");
    expect((await storedOrder(test, order.id)).state).toBe("cancelled");
    expect(noticesOf(test)).toMatchObject([{ key: "notice.fillsFailing", values: { count: "5" } }]);
    expect(await fillRowsOf(test, order.id)).toHaveLength(5);
  });
});
