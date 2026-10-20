import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import { orderFillRecordSchema } from "../orders/order-fill.js";
import { createDowntimeCheck } from "./downtime-check.js";

// The fields of an order the re-check reads: its id, agent and kind.
const stop = {
  id: idSchema("ord").parse("ord_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  agentId: testAgent,
  kind: "stopLoss",
} as const;
const dca = {
  id: idSchema("ord").parse("ord_0190f1c2-3a4b-7c5d-8e6f-000000000002"),
  agentId: testAgent,
  kind: "dca",
} as const;

function begun() {
  const check = createDowntimeCheck();
  const orders = [stop, dca];
  check.begin({ cause: "start", offFromMs: testNowMs - 3_600_000, atMs: testNowMs, orders });
  return check;
}

// A skip row of `order`, numbered `n`, written at `atMs`.
function row(
  order: typeof stop | typeof dca,
  skip: { readonly reason: string; readonly atMs: number; readonly n: number },
) {
  return orderFillRecordSchema.parse({
    id: `fil_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(skip.n)}`,
    orderId: order.id,
    outcome: "skipped",
    reason: skip.reason,
    atMs: skip.atMs,
  });
}

describe("the downtime re-check's state", () => {
  it("calls no price stale before the first resume, then every price read before the latest", () => {
    const check = createDowntimeCheck();
    const before = check.isStale(0);
    check.begin({ cause: "wake", offFromMs: 0, atMs: testNowMs, orders: [] });
    check.begin({ cause: "wake", offFromMs: testNowMs, atMs: testNowMs + 90_000, orders: [] });

    expect(before).toBe(false);
    expect(
      [testNowMs + 89_999, testNowMs + 90_000].map((atMs) => check.isStale(atMs)),
    ).toStrictEqual([true, false]);
    expect(check.open()).toMatchObject({ cause: "wake", offMs: testNowMs + 90_000 });
  });

  it("takes a price order's first fresh judgment, never a stale one or a later one", () => {
    const check = begun();
    check.judged({ order: stop, readAtMs: testNowMs - 1, fires: false });
    check.judged({ order: stop, readAtMs: testNowMs, fires: true });
    check.judged({ order: stop, readAtMs: testNowMs + 1, fires: false });

    expect(check.open()?.orders.get(stop.id)?.standing).toStrictEqual({ state: "firing" });
  });

  it("sends a fill back to wait for a fresh price when a resume came while it ran", () => {
    const check = begun();
    check.judged({ order: stop, readAtMs: testNowMs, fires: true });
    check.begin({ cause: "wake", offFromMs: testNowMs, atMs: testNowMs + 90_000, orders: [] });
    check.fillEnded({ order: stop.id, readAtMs: testNowMs, outcome: "skipped" });

    expect(check.open()?.orders.get(stop.id)?.standing).toStrictEqual({ state: "pending" });
    expect(check.open()?.cause).toBe("start");
  });

  it("holds only the skip of its own fill and a DCA order's first skip of the downtime", () => {
    const check = begun();
    const beforeFill = check.holds(row(stop, { reason: "fill_failed", atMs: testNowMs, n: 1 }));
    check.judged({ order: stop, readAtMs: testNowMs, fires: true });
    const ownFill = check.holds(row(stop, { reason: "worst_price", atMs: testNowMs + 1, n: 2 }));
    check.fillEnded({ order: stop.id, readAtMs: testNowMs, outcome: "skipped" });
    const later = check.holds(row(stop, { reason: "worst_price", atMs: testNowMs + 2, n: 3 }));

    expect([beforeFill, ownFill, later]).toStrictEqual([false, true, false]);
    expect(check.open()?.orders.get(stop.id)?.standing).toMatchObject({
      reason: "worst_price",
      fromRow: true,
    });
    expect([
      check.holds(row(dca, { reason: "missed", atMs: testNowMs - 1, n: 4 })),
      check.holds(row(dca, { reason: "fill_failed", atMs: testNowMs, n: 5 })),
      check.holds(row(dca, { reason: "missed", atMs: testNowMs, n: 6 })),
      check.holds(row(dca, { reason: "late", atMs: testNowMs + 1, n: 7 })),
    ]).toStrictEqual([false, false, true, false]);
    check.close();
    expect(check.holds(row(dca, { reason: "missed", atMs: testNowMs, n: 6 }))).toBe(false);
  });
});
