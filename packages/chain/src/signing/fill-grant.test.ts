import { type Id, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type AccountRef, accountRefSchema } from "../caip/account-ref.js";
import {
  checkFillGrant,
  type FillGrant,
  type FillGrantCheck,
  fillGrantSchema,
  type OrderNow,
  orderNowSchema,
} from "./fill-grant.js";

const nowMs = 1_800_000_000_000;
const order = "ord_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"ord">;
const otherOrder = "ord_0190f1c2-3a4b-7c5d-8e6f-000000000002" as Id<"ord">;
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"agt">;
const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"int">;
const otherIntent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000002" as Id<"int">;
const token: AccountRef = accountRefSchema.parse(`eip155:56:0x${"11".repeat(20)}`);
const spender: AccountRef = accountRefSchema.parse(`eip155:56:0x${"22".repeat(20)}`);
const fillTerms = "a".repeat(64);
const orderTerms = "b".repeat(64);

const grant: FillGrant = {
  order,
  agent,
  intent,
  orderTermsHash: orderTerms,
  fillsBefore: 1,
  termsHash: fillTerms,
  grantedAtMs: nowMs,
  expiresAtMs: nowMs + 60_000,
  networkFeeCapNativeBase: 1_000_000_000n,
  spend: { maxBase: 10n ** 16n },
};

const current: OrderNow = {
  id: order,
  state: "active",
  termsHash: orderTerms,
  expiresAtMs: nowMs + 3_600_000,
  fills: 1,
  maxFills: 2,
};

const signing: FillGrantCheck = {
  intent,
  termsHash: fillTerms,
  order: current,
  action: { kind: "call", nativeValue: 10n ** 16n },
  isCancel: false,
  feePerGasNativeBase: 1_000_000_000n,
  nowMs: nowMs + 59_999,
};

function problemOf(
  changes: Partial<FillGrantCheck>,
  orderNow: Partial<OrderNow> = {},
  granted: Partial<FillGrant> = {},
) {
  const checked = checkFillGrant(
    { ...grant, ...granted },
    { ...signing, ...changes, order: { ...current, ...orderNow } },
  );
  return checked.ok ? "holds" : checked.error;
}

describe("the fill grant", () => {
  it("holds for one fill of its order, until it expires", () => {
    expect(checkFillGrant(grant, signing)).toStrictEqual(ok(grant));
    expect(problemOf({ nowMs: nowMs + 60_000 })).toBe("expired");
  });

  it("names a request for another intent, order or terms, or an order whose card changed", () => {
    expect(problemOf({ intent: otherIntent })).toBe("intent_mismatch");
    expect(problemOf({}, { id: otherOrder })).toBe("order_mismatch");
    expect(problemOf({}, { termsHash: "c".repeat(64) })).toBe("order_changed");
    expect(problemOf({ termsHash: "c".repeat(64) })).toBe("terms_mismatch");
  });

  it("signs nothing once its order is no longer active, expired or used its last fill", () => {
    expect(problemOf({}, { state: "paused" })).toBe("order_inactive");
    expect(problemOf({}, { state: "filled" })).toBe("order_inactive");
    expect(problemOf({}, { expiresAtMs: signing.nowMs })).toBe("order_inactive");
    expect(problemOf({}, { fills: 2 })).toBe("order_inactive");
  });

  it("signs nothing once its order recorded a fill since the grant", () => {
    expect(problemOf({}, { fills: 2, maxFills: 5 })).toBe("order_filled_since");
    expect(problemOf({}, { fills: 0 })).toBe("order_filled_since");
    const { maxFills: _bound, ...unbounded } = current;
    expect(checkFillGrant(grant, { ...signing, order: unbounded }).ok).toBe(true);
  });

  it("signs a transaction at the fee cap per gas, and none above it", () => {
    expect(problemOf({ feePerGasNativeBase: 0n })).toBe("holds");
    expect(problemOf({ feePerGasNativeBase: 1_000_000_001n })).toBe("over_fee_cap");
  });

  it("spends at most its size of the coin it spends, and nothing else", () => {
    expect(problemOf({ action: { kind: "call", nativeValue: 10n ** 16n + 1n } })).toBe("over_size");
    const send = { kind: "send", recipient: spender, amount: 1n } as const;
    expect(problemOf({ action: send })).toBe("over_size");
    const approval = { kind: "approve", token, spender, amount: 1n } as const;
    expect(problemOf({ action: approval })).toBe("over_size");
  });

  it("approves at most its size of the token it sells, and sends no coin with its call", () => {
    const sale = { spend: { token, maxBase: 1_000n } };
    const approval = { kind: "approve", token, spender, amount: 1_000n } as const;
    expect(problemOf({ action: approval }, {}, sale)).toBe("holds");
    expect(problemOf({ action: { ...approval, amount: 1_001n } }, {}, sale)).toBe("over_size");
    expect(problemOf({ action: { kind: "call", nativeValue: 0n } }, {}, sale)).toBe("holds");
    expect(problemOf({ action: { kind: "call", nativeValue: 1n } }, {}, sale)).toBe("over_size");
  });

  it("signs a cancel of its own fill whatever its order became, a minute past its expiry", () => {
    const cancel = { isCancel: true, nowMs: nowMs + 119_999 };
    expect(problemOf(cancel, { state: "filled", fills: 2 })).toBe("holds");
    expect(problemOf({ ...cancel, nowMs: nowMs + 120_000 })).toBe("expired");
    expect(problemOf({ ...cancel, intent: otherIntent })).toBe("intent_mismatch");
  });

  it("travels as JSON and back", () => {
    const wire = z.encode(fillGrantSchema, grant);
    expect(wire.networkFeeCapNativeBase).toBe("1000000000");
    expect(fillGrantSchema.parse(JSON.parse(JSON.stringify(wire)))).toStrictEqual(grant);
    expect(orderNowSchema.parse(z.encode(orderNowSchema, current))).toStrictEqual(current);
  });
});
