import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import { orderFillRecordSchema } from "../orders/order-fill.js";
import { createDowntimeCheck, type DowntimeCheck } from "./downtime-check.js";

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
const hourMs = 3_600_000;

function skipRow(
  order: { readonly id: string },
  call: { readonly reason: string; readonly atMs: number; readonly n?: number },
) {
  return orderFillRecordSchema.parse({
    id: `fil_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(call.n ?? 9)}`,
    orderId: order.id,
    outcome: "skipped",
    reason: call.reason,
    atMs: call.atMs,
  });
}

// A re-check open since a start at `testNowMs`, its fence up.
function begun(): DowntimeCheck {
  const check = createDowntimeCheck();
  check.fence(testNowMs);
  const span = { offFromMs: testNowMs - hourMs, offMs: hourMs, atMs: testNowMs };
  check.begin({ cause: "start", ...span, orders: [stop, dca] });
  return check;
}

const standingOf = (check: DowntimeCheck) => check.open()?.orders.get(stop.id)?.standing;

describe("the downtime re-check's state", () => {
  it("fences at once: every price read before the latest resume, even one set back", () => {
    const check = createDowntimeCheck();
    const before = [check.isStale(0), check.resumes()];
    check.fence(testNowMs);
    const afterStart = [testNowMs - 1, testNowMs].map((atMs) => check.isStale(atMs));
    check.fence(testNowMs - hourMs);

    expect(before).toStrictEqual([false, 0]);
    expect(afterStart).toStrictEqual([true, false]);
    expect(check.isStale(testNowMs - hourMs + 1)).toBe(false);
    expect(check.resumes()).toBe(2);
  });

  it("takes a price order's first judgment under the latest resume, never an older or a later one", () => {
    const check = begun();
    check.judged({ order: stop, resumes: 0, verdict: "not_met", atMs: testNowMs });
    check.judged({ order: stop, resumes: 1, verdict: "rearming", atMs: testNowMs + 1 });
    check.judged({ order: stop, resumes: 1, verdict: "fires", atMs: testNowMs + 2 });

    expect(standingOf(check)).toStrictEqual({
      state: "skipped",
      reason: "rearming",
      atMs: testNowMs + 1,
    });
  });

  it("sends a fill a later resume overtook back to wait for a fresh price, its count behind", () => {
    const check = begun();
    check.judged({ order: stop, resumes: 1, verdict: "fires", atMs: testNowMs });
    check.fence(testNowMs + 90_000);
    check.fillEnded({ order: stop.id, resumes: 1, outcome: "skipped" });

    expect(standingOf(check)).toStrictEqual({ state: "pending" });
  });

  it("keeps a fill whose old run still holds the order waiting, and counts a sent live fill", () => {
    const outcomes = (["inactive", "waiting", "sent", "ended"] as const).map((outcome) => {
      const check = begun();
      check.judged({ order: stop, resumes: 1, verdict: "fires", atMs: testNowMs });
      check.fillEnded({ order: stop.id, resumes: 1, outcome });
      return standingOf(check);
    });

    expect(outcomes).toStrictEqual([
      { state: "pending" },
      { state: "skipped", reason: "behind_fill", atMs: testNowMs },
      { state: "sent", atMs: testNowMs },
      { state: "skipped", reason: "position_closed", atMs: testNowMs },
    ]);
  });

  it("holds only the skip of its own fill and a DCA order's first skip of the downtime", () => {
    const check = begun();
    const beforeFill = check.holds(skipRow(stop, { reason: "fill_failed", atMs: testNowMs }));
    check.judged({ order: stop, resumes: 1, verdict: "fires", atMs: testNowMs });
    const ownFill = check.holds(skipRow(stop, { reason: "worst_price", atMs: testNowMs + 1 }));
    check.fillEnded({ order: stop.id, resumes: 1, outcome: "skipped" });
    const later = check.holds(skipRow(stop, { reason: "worst_price", atMs: testNowMs + 2, n: 8 }));

    expect([beforeFill, ownFill, later]).toStrictEqual([false, true, false]);
    expect(standingOf(check)).toMatchObject({ reason: "worst_price", fromRow: true });
    expect([
      check.holds(skipRow(dca, { reason: "missed", atMs: testNowMs - 1, n: 1 })),
      check.holds(skipRow(dca, { reason: "fill_failed", atMs: testNowMs, n: 2 })),
      check.holds(skipRow(dca, { reason: "missed", atMs: testNowMs, n: 3 })),
      check.holds(skipRow(dca, { reason: "late", atMs: testNowMs + 1, n: 4 })),
    ]).toStrictEqual([false, false, true, false]);
    check.close();
    expect(check.holds(skipRow(dca, { reason: "missed", atMs: testNowMs, n: 3 }))).toBe(false);
  });
});
