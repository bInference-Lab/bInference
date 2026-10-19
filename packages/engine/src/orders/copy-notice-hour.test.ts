import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent, testNowMs, testWallet } from "../intents/test-intents.js";
import { noticeHourMs } from "../notices/notice-hour.js";
import type { CopyOrder } from "./copy-fills.js";
import { copyAnnouncementOf, type DueRow } from "./copy-notice-hour.js";
import { copyStartOf, copyStateDocument } from "./copy-state.js";
import { testCopy } from "./test-orders.js";

const order: CopyOrder = {
  id: idSchema("ord").parse("ord_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  agentId: testAgent,
  walletId: testWallet,
  kind: "copy",
  state: "active",
  request: testCopy(),
  expiresAtMs: testNowMs + 10 * noticeHourMs,
  intentId: idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  isPaper: true,
  hasOutsideContent: false,
  triggerState: copyStateDocument.encode(copyStartOf(0)),
  fills: 0,
  createdAtMs: 0,
  changedAtMs: 0,
  version: 1,
};

// Row `n` at `atMs`: a skip, or a fill, each with one notice that names it.
function rowOf(n: number, atMs: number, outcome: "skipped" | "filled" = "skipped"): DueRow {
  const id = idSchema("fil").parse(
    `fil_0190f1c2-3a4b-7c5d-8e6f-0000000000${String(n).padStart(2, "0")}`,
  );
  const reason = outcome === "skipped" ? { reason: "late" as const } : {};
  return { id, orderId: order.id, outcome, ...reason, atMs, notices: [{ row: n }] };
}

describe("a copy order's notice hour", () => {
  it("tells five skips an hour and every fill, then the held count before the next hour's first", () => {
    const skips = [1, 2, 3, 4, 5, 6, 7].map((n) => rowOf(n, testNowMs + n));
    const fill = rowOf(8, testNowMs + 8, "filled");
    const next = rowOf(9, testNowMs + 1 + noticeHourMs);
    const hour = { startedAtMs: testNowMs + 1, sent: 5, held: 2 };
    const state = copyStateDocument.encode({ ...copyStartOf(0), notices: hour });

    const first = copyAnnouncementOf(order, [...skips, fill]);
    const later = copyAnnouncementOf({ ...order, triggerState: state }, [next]);

    expect(first.told).toStrictEqual([1, 2, 3, 4, 5, 8].map((row) => ({ row })));
    expect(first.hour).toStrictEqual(hour);
    expect(later.told).toMatchObject([
      { key: "notice.copyHeld", values: { count: "2" } },
      { row: 9 },
    ]);
  });
});
