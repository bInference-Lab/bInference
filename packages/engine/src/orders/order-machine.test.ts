import { idSchema } from "@binference/core";
import type { OrderState } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testAgent, testToken, testWallet } from "../intents/test-intents.js";
import { moveOrder, orderExpiryNoticeMs, type OrderTrigger } from "./order-machine.js";
import type { OrderRecord } from "./order-record.js";

const intentId = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const cardId = idSchema("crd").parse("crd_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const expiresAtMs = 10_000_000;

function orderIn(state: OrderState, changes: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: idSchema("ord").parse("ord_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    agentId: testAgent,
    walletId: testWallet,
    kind: "stopLoss",
    state,
    request: {
      kind: "stopLoss",
      agent: testAgent,
      token: testToken,
      side: "sell",
      size: { usdMicros: 1n },
      trigger: { price: 1n },
    },
    fills: 0,
    maxFills: 2,
    expiresAtMs,
    intentId,
    ...(state === "awaiting_confirmation" ? {} : { cardId }),
    isPaper: false,
    hasOutsideContent: false,
    createdAtMs: 1,
    changedAtMs: 1,
    version: 3,
    ...changes,
  };
}

const tap: OrderTrigger = {
  type: "card_confirmed",
  confirmation: { intentId, cardId },
  isAgentFrozen: false,
};

// Each row: the state, the trigger, the time, and the state it moves to or why it does not.
const table: readonly (readonly [OrderState, OrderTrigger, number, string])[] = [
  ["awaiting_confirmation", tap, 5, "active"],
  ["awaiting_confirmation", { ...tap, isAgentFrozen: true }, 5, "frozen"],
  ["awaiting_confirmation", { type: "card_confirmed", isAgentFrozen: false }, 5, "not_confirmed"],
  ["awaiting_confirmation", tap, expiresAtMs, "expired"],
  ["awaiting_confirmation", { type: "card_closed", outcome: "denied" }, 5, "cancelled"],
  ["awaiting_confirmation", { type: "card_closed", outcome: "expired" }, 5, "expired"],
  ["awaiting_confirmation", { type: "agent_frozen" }, 5, "cancelled"],
  ["active", tap, 5, "wrong_state"],
  ["active", { type: "agent_frozen" }, 5, "paused"],
  ["paused", { type: "agent_frozen" }, 5, "wrong_state"],
  ["paused", { type: "agent_unfrozen" }, 5, "active"],
  ["active", { type: "trigger_kept", triggerState: { peak: "1" } }, 5, "active"],
  ["active", { type: "fill_recorded", emptiesPosition: true }, 5, "ended"],
  ["paused", { type: "trigger_kept", triggerState: { peak: "1" } }, 5, "wrong_state"],
  ["paused", { type: "agent_unfrozen" }, expiresAtMs, "expired"],
  ["paused", { type: "fill_recorded" }, 5, "wrong_state"],
  ["paused", { type: "cancel_requested" }, 5, "cancelled"],
  ["active", { type: "expiry_reached" }, expiresAtMs - 1, "not_expired"],
  ["active", { type: "expiry_reached" }, expiresAtMs, "expired"],
  ["active", { type: "fill_recorded" }, 5, "active"],
  ["active", { type: "fill_recorded" }, expiresAtMs, "expired"],
  ["active", { type: "position_closed" }, 5, "ended"],
  ["cancelled", { type: "cancel_requested" }, 5, "ended"],
  ["expired", { type: "agent_unfrozen" }, 5, "ended"],
  ["active", { type: "expiry_noticed" }, expiresAtMs - orderExpiryNoticeMs - 1, "not_due"],
  ["active", { type: "expiry_noticed" }, expiresAtMs - orderExpiryNoticeMs, "active"],
];

/** One row of the table, named for its trigger. */
interface Row {
  readonly state: OrderState;
  readonly trigger: OrderTrigger;
  readonly on: OrderTrigger["type"];
  readonly nowMs: number;
  readonly outcome: string;
}

const rows: readonly Row[] = table.map(([state, trigger, nowMs, outcome]) => ({
  state,
  trigger,
  on: trigger.type,
  nowMs,
  outcome,
}));

// The state a move reaches, or the machine's reason to refuse it.
function outcomeOf(row: Row): string {
  const moved = moveOrder(orderIn(row.state), row.trigger, row.nowMs);
  return moved.ok ? moved.value.state : moved.error;
}

describe("the order state machine", () => {
  it.each(rows)("moves $state on $on at $nowMs to $outcome", (row: Row) => {
    expect(outcomeOf(row)).toBe(row.outcome);
  });

  it("fills an order's last fill as filled, keeps the card a tap confirmed, and ends an exit only", () => {
    const last = moveOrder(orderIn("active", { fills: 1 }), { type: "fill_recorded" }, 5);
    const spent = moveOrder(orderIn("active", { fills: 2 }), { type: "fill_recorded" }, 5);
    const tapped = moveOrder(orderIn("awaiting_confirmation"), tap, 5);
    const buy = orderIn("active", {
      kind: "limit",
      request: {
        kind: "limit",
        agent: testAgent,
        token: testToken,
        side: "buy",
        size: { usdMicros: 1n },
        trigger: { price: 1n, direction: "below" },
      },
    });

    expect(last).toMatchObject({ ok: true, value: { state: "filled", fills: 2 } });
    expect(spent).toStrictEqual({ ok: false, error: "no_fill_left" });
    expect(tapped).toMatchObject({ ok: true, value: { cardId, expectedVersion: 3, atMs: 5 } });
    expect(moveOrder(buy, { type: "position_closed" }, 5)).toStrictEqual({
      ok: false,
      error: "not_exit",
    });
    const ended = moveOrder(orderIn("paused"), { type: "position_closed" }, 5);
    expect(ended).toMatchObject({ ok: true, value: { endReason: "position_closed" } });
  });
});
