import { err, idSchema, ok, type Result } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it, vi } from "vitest";
import { testAgent, testNowMs, testWallet } from "../intents/test-intents.js";
import { noticeHourMs } from "../notices/notice-hour.js";
import type { CopyOrder } from "./copy-fills.js";
import { copyAnnouncementOf, type DueRow, toldOf } from "./copy-notice-hour.js";
import { copyStartOf, copyStateDocument, copyStateOf } from "./copy-state.js";
import type { OrderMove, OrderRecord } from "./order-record.js";
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

  it("counts again on a fresh read when another write of the order came first", async () => {
    const counted = { startedAtMs: testNowMs, sent: 5, held: 0 };
    const fresh = {
      ...order,
      version: 2,
      triggerState: copyStateDocument.encode({ ...copyStartOf(0), notices: counted }),
    };
    const reads: OrderRecord[] = [order, fresh];
    const move = vi
      .fn<(moves: readonly OrderMove[]) => Promise<Result<readonly OrderRecord[], "stale">>>()
      .mockResolvedValueOnce(err("stale"))
      .mockResolvedValue(ok([]));
    const orders = { get: async () => Promise.resolve(reads.shift()), move };
    const parts = { orders, clock: createManualClock(testNowMs) };

    const told = await toldOf(parts, [rowOf(1, testNowMs + 1)], AbortSignal.timeout(1_000));

    expect(told).toStrictEqual([]);
    expect(move).toHaveBeenCalledTimes(2);
    const kept = move.mock.calls[1]?.[0][0]?.triggerState;
    expect(copyStateOf(kept)?.notices).toStrictEqual({ ...counted, held: 1 });
  });
});
