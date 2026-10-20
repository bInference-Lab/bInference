import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import { type OrderFillRecord, orderFillRecordSchema } from "../orders/order-fill.js";
import type { OrderStore } from "../orders/ports.js";
import { checkedOrdersOf } from "./checked-orders.js";
import type { OpenCheck, WatchedOrder } from "./downtime-check.js";

const live = new AbortController().signal;
const copy = idSchema("ord").parse("ord_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const stop = idSchema("ord").parse("ord_0190f1c2-3a4b-7c5d-8e6f-000000000002");

function row(
  n: number,
  fields: {
    readonly orderId: string;
    readonly outcome: string;
    readonly reason?: string;
    readonly atMs: number;
  },
) {
  return orderFillRecordSchema.parse({
    id: `fil_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(n)}`,
    ...fields,
  });
}

// Each order's rows, the newest first, as the order store answers them.
function storeOf(rows: readonly OrderFillRecord[]): Pick<OrderStore, "get" | "fills"> {
  return {
    get: async () => Promise.resolve(undefined),
    fills: async ({ orderId }) =>
      Promise.resolve(rows.filter((each) => each.orderId === orderId).toReversed()),
  };
}

function openOf(orders: readonly (readonly [typeof copy, WatchedOrder])[]): OpenCheck {
  const span = { cause: "start", offFromMs: 0, offMs: 0, sinceMs: testNowMs } as const;
  return { ...span, orders: new Map(orders), held: new Map() };
}

describe("what the report finds of each order", () => {
  it("shows a copy order's skip of the downtime though a fill of it came after", async () => {
    const rows = [
      row(1, { orderId: copy, outcome: "skipped", reason: "late", atMs: testNowMs + 1 }),
      row(2, { orderId: copy, outcome: "filled", atMs: testNowMs + 2 }),
    ];
    const watched = { agentId: testAgent, kind: "copy", standing: { state: "pending" } } as const;

    const found = await checkedOrdersOf(
      { orders: storeOf(rows), rows: 12 },
      openOf([[copy, watched]]),
      live,
    );

    expect(found).toMatchObject([{ order: copy, outcome: "skipped", reason: "late" }]);
  });

  it("counts the skip the start's repair wrote before an order's first judgment", async () => {
    const rows = [
      row(3, { orderId: stop, outcome: "skipped", reason: "fill_failed", atMs: testNowMs + 1 }),
    ];
    const standing = { state: "skipped", reason: "trigger_not_met", atMs: testNowMs + 5 } as const;
    const watched = { agentId: testAgent, kind: "stopLoss", standing } as const;

    const found = await checkedOrdersOf(
      { orders: storeOf(rows), rows: 12 },
      openOf([[stop, watched]]),
      live,
    );

    expect(found).toMatchObject([{ order: stop, outcome: "skipped", reason: "fill_failed" }]);
  });
});
