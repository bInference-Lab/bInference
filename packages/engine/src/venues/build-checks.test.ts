import {
  accountRefSchema,
  assetRefSchema,
  chainRefSchema,
  type DecodedEffect,
  type DraftCall,
  type TokenApproval,
  type TxDraft,
} from "@binference/chain";
import { createFakeFamily, fakeDraft } from "@binference/chain/testing";
import type { Bps } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  type ApprovalStep,
  type BuildMismatch,
  checkSteps,
  minOutFloor,
  type PlanStep,
  type TradeBounds,
  type TradeStep,
} from "./build-checks.js";

const nowMs = 1_800_000_000_000;
const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const router = accountRefSchema.parse("fake:1:0x0000000b");
const stranger = accountRefSchema.parse("fake:1:0x0000000e");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:0x0000000a");
const other = assetRefSchema.parse("fake:1/token:0x0000000f");

// Sells 500 units of the token for at least 990 units of the coin.
const bounds: TradeBounds = {
  wallet,
  amountIn: { asset: token, base: 500n },
  assetOut: coin,
  nativeAsset: coin,
  contracts: [router],
  minOutBase: 990n,
  latestDeadlineMs: nowMs + 60_000,
  family: createFakeFamily(),
};

const effect: DecodedEffect = {
  recipient: wallet,
  amountIn: bounds.amountIn,
  minOut: { asset: coin, base: 990n },
  deadlineMs: nowMs + 60_000,
};

function approvalStep(changes: Partial<TokenApproval> = {}, call: Partial<DraftCall> = {}) {
  const approval = { asset: token, spender: router, amountBase: 500n, ...changes };
  const step: ApprovalStep = {
    kind: "approval",
    draft: fakeDraft(wallet, { to: "0x0000000a", value: 0n, data: "approve" }),
    call: { target: accountRefSchema.parse("fake:1:0x0000000a"), nativeValue: 0n, ...call },
    approval,
  };
  return step;
}

function tradeStep(changes: Partial<DecodedEffect> = {}, call: Partial<DraftCall> = {}) {
  const step: TradeStep = {
    kind: "trade",
    draft: fakeDraft(wallet, { to: "0x0000000b", value: 0n, data: "swap" }),
    call: { target: router, nativeValue: 0n, ...call },
    effect: { ...effect, ...changes },
  };
  return step;
}

function fromStranger(step: PlanStep): PlanStep {
  return { ...step, draft: fakeDraft(stranger, { to: "0x0000000b", value: 0n, data: "swap" }) };
}

describe("build-step checks", () => {
  it("passes an exact approval and a trade call that keeps every term", () => {
    expect(checkSteps([approvalStep(), tradeStep()], bounds)).toStrictEqual({
      ok: true,
      value: effect,
    });
  });

  it("passes a trade call alone, and one whose wallet is written in another case", () => {
    const upper = accountRefSchema.parse("fake:1:0x0000000C");
    expect(checkSteps([tradeStep({ recipient: upper })], bounds)).toStrictEqual({
      ok: true,
      value: { ...effect, recipient: upper },
    });
  });

  it("passes a coin input sent as the call's value", () => {
    const spendCoin = { ...bounds, amountIn: { asset: coin, base: 7n }, assetOut: token };
    const step = tradeStep(
      { amountIn: spendCoin.amountIn, minOut: { asset: token, base: 990n } },
      { nativeValue: 7n },
    );
    expect(checkSteps([step], spendCoin).ok).toBe(true);
  });

  it.each<[string, readonly PlanStep[], BuildMismatch]>([
    ["a step from another account", [fromStranger(tradeStep())], "other_sender"],
    ["no step", [], "step_order"],
    ["an approval alone", [approvalStep()], "step_order"],
    ["the approval after the trade call", [tradeStep(), approvalStep()], "step_order"],
    ["two trade calls", [tradeStep(), tradeStep()], "step_order"],
    ["three steps", [approvalStep(), approvalStep(), tradeStep()], "step_order"],
    [
      "a trade call to an undeclared contract",
      [tradeStep({}, { target: stranger })],
      "undeclared_contract",
    ],
    [
      "an approval to an undeclared spender",
      [approvalStep({ spender: stranger }), tradeStep()],
      "undeclared_contract",
    ],
    [
      "an approval above the input",
      [approvalStep({ amountBase: 501n }), tradeStep()],
      "other_approval",
    ],
    [
      "an approval of another token",
      [approvalStep({ asset: other }), tradeStep()],
      "other_approval",
    ],
    [
      "an approval that sends the coin",
      [approvalStep({}, { nativeValue: 1n }), tradeStep()],
      "other_approval",
    ],
    [
      "a trade call that pays another account",
      [tradeStep({ recipient: stranger })],
      "other_recipient",
    ],
    [
      "a trade call that spends more",
      [tradeStep({ amountIn: { asset: token, base: 501n } })],
      "other_amount",
    ],
    [
      "a trade call that spends another token",
      [tradeStep({ amountIn: { asset: other, base: 500n } })],
      "other_amount",
    ],
    [
      "a token trade call that also sends the coin",
      [tradeStep({}, { nativeValue: 1n })],
      "other_amount",
    ],
    [
      "a minimum out below the policy's",
      [tradeStep({ minOut: { asset: coin, base: 989n } })],
      "low_min_out",
    ],
    [
      "a minimum out in another asset",
      [tradeStep({ minOut: { asset: other, base: 990n } })],
      "low_min_out",
    ],
    ["a deadline past 60 seconds", [tradeStep({ deadlineMs: nowMs + 60_001 })], "late_deadline"],
  ])("refuses %s", (_case, steps, mismatch) => {
    expect(checkSteps(steps, bounds)).toStrictEqual({ ok: false, error: mismatch });
  });

  it.each<[string, Partial<TxDraft>]>([
    ["a draft on another chain", { chain: chainRefSchema.parse("fake:2") }],
    [
      "the same address on another chain",
      fakeDraft(accountRefSchema.parse("fake:2:0x0000000c"), {
        to: "0x0000000b",
        value: 0n,
        data: "swap",
      }),
    ],
  ])("refuses %s as another sender", (_case, changes) => {
    const step = tradeStep();
    const elsewhere: PlanStep = { ...step, draft: { ...step.draft, ...changes } };
    expect(checkSteps([elsewhere], bounds)).toStrictEqual({ ok: false, error: "other_sender" });
  });

  it("rounds the policy's minimum out up", () => {
    expect(minOutFloor(2_002n, 50 as Bps)).toBe(1_992n);
    expect(minOutFloor(2_000n, 50 as Bps)).toBe(1_990n);
    expect(minOutFloor(2_000n, 0 as Bps)).toBe(2_000n);
  });
});
