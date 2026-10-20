import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { resumeReportPayloadSchema } from "../chat/inbox-payload.schema.js";
import { testAgent } from "../intents/test-intents.js";
import type { CheckedSkipReason } from "./downtime-check.js";
import {
  type CheckedOrder,
  type DowntimeReport,
  resumedNotice,
  resumeReportPayload,
} from "./downtime-report.js";

const otherAgent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const order = (n: number) =>
  idSchema("ord").parse(`ord_0190f1c2-3a4b-7c5d-8e6f-${String(n).padStart(12, "0")}`);

function skippedOrder(n: number, reason: CheckedSkipReason): CheckedOrder {
  return { order: order(n), agentId: testAgent, kind: "stopLoss", outcome: "skipped", reason };
}

const cap = {
  key: "reason.daily_cap",
  values: { used: "$900.00", cap: "$1,000.00" },
};

function reportOf(orders: readonly CheckedOrder[], offMs = 3 * 3_600_000): DowntimeReport {
  return { cause: "wake", offFromMs: 0, offMs, orders };
}

describe("the resume report", () => {
  it("tells the span, the counts and the three commonest skip reasons, the rest in one line", () => {
    const orders = [
      { order: order(1), agentId: testAgent, kind: "takeProfit", outcome: "filled" } as const,
      skippedOrder(2, "trigger_not_met"),
      skippedOrder(3, "trigger_not_met"),
      skippedOrder(4, "worst_price"),
      { ...skippedOrder(5, "daily_cap"), reasonPart: cap },
      skippedOrder(6, "no_fresh_price"),
      skippedOrder(7, "daily_cap"),
    ];

    expect(resumedNotice(reportOf(orders))).toStrictEqual({
      key: "notice.resumed",
      values: { cause: "wake", checked: "7", filled: "1", skipped: "6" },
      parts: { duration: { key: "pnl.hours", values: { count: "3" } } },
      after: [
        {
          key: "order.resumedSkips",
          values: { count: "2" },
          parts: { reason: { key: "reason.trigger_not_met", values: {} } },
        },
        { key: "order.resumedSkips", values: { count: "1" }, parts: { reason: cap } },
        {
          key: "order.resumedSkips",
          values: { count: "1" },
          parts: { reason: { key: "reason.no_fresh_price", values: {} } },
        },
        { key: "order.resumedOther", values: { count: "2" } },
      ],
    });
  });

  it("tells a stop under a minute, and adds no line when nothing was skipped", () => {
    const notice = resumedNotice({ ...reportOf([], 20_000), cause: "start" });

    expect(notice).toStrictEqual({
      key: "notice.resumed",
      values: { cause: "start", checked: "0", filled: "0", skipped: "0" },
      parts: { duration: { key: "order.underMinute", values: {} } },
    });
  });

  it("names a clock set back, and tells the live fills sent but not settled in a line first", () => {
    const sent = {
      order: order(1),
      agentId: testAgent,
      kind: "stopLoss",
      outcome: "sent",
    } as const;
    const report = { ...reportOf([sent, skippedOrder(2, "worst_price")]), cause: "clock" } as const;

    expect(resumedNotice(report)).toMatchObject({
      values: { cause: "clock", checked: "2", filled: "0", skipped: "1" },
      after: [
        { key: "order.resumedSent", values: { count: "1" } },
        { key: "order.resumedSkips", values: { count: "1" } },
      ],
    });
  });

  it("gives each agent its own counts and orders, at most 50", () => {
    const own = Array.from({ length: 51 }, (_, index) => skippedOrder(index + 1, "worst_price"));
    const other = { ...skippedOrder(99, "worst_price"), agentId: otherAgent };

    const payload = resumeReportPayloadSchema.parse(
      resumeReportPayload(reportOf([...own, other]), testAgent),
    );

    expect(payload).toMatchObject({ cause: "wake", checked: 51, filled: 0, skipped: 51 });
    expect(payload.orders).toHaveLength(50);
    expect(payload.orders.map(({ order: id }) => id)).not.toContain(order(99));
  });
});
