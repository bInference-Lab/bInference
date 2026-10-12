import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { type BoundedOrder, checkFill, fillLimitBase, quotePrice } from "./fill-bounds.js";

const nowMs = 1_800_000_000_000;
// A stablecoin at $1 for each of its 10^18 base units, and a token with 18 decimals.
const dollar = { numerator: 1n, denominator: 10n ** 12n };
const whole = 10n ** 18n;

const limitBuy: BoundedOrder = {
  state: "active",
  fills: 0,
  maxFills: 1,
  expiresAtMs: nowMs + 60_000,
  request: { side: "buy", worstPrice: 2_000_000n, maxSlippageBps: bpsSchema.parse(100) },
};

const facts = {
  nowMs,
  limitBase: 100n * whole,
  maxSlippageBps: bpsSchema.parse(100),
  otherUsd: dollar,
  tokenDecimals: 18,
};

describe("a fill's bounds", () => {
  it("takes a buy that pays exactly its worst price, and refuses one a unit dearer", () => {
    const atWorst = {
      amountInBase: 100n * whole,
      expectedOutBase: 55n * whole,
      minOutBase: 50n * whole,
    };
    expect(checkFill(limitBuy, atWorst, facts)).toStrictEqual({ ok: true, value: undefined });
    const dearer = { ...atWorst, minOutBase: 50n * whole - 1n };
    expect(checkFill(limitBuy, dearer, facts)).toStrictEqual({ ok: false, error: "worst_price" });
  });

  it("refuses a sale below its worst price, and one nothing can value", () => {
    const sale: BoundedOrder = { ...limitBuy, request: { ...limitBuy.request, side: "sell" } };
    const low = { amountInBase: whole, expectedOutBase: 2n * whole, minOutBase: 2n * whole - 1n };
    expect(checkFill(sale, low, facts)).toMatchObject({ error: "worst_price" });
    const unpriced = {
      nowMs,
      limitBase: whole,
      maxSlippageBps: facts.maxSlippageBps,
      tokenDecimals: 18,
    };
    expect(checkFill(sale, { ...low, minOutBase: 3n * whole }, unpriced)).toMatchObject({
      error: "worst_price",
    });
  });

  it("refuses more slippage than the order allows, or none named when the order names one", () => {
    const quote = { amountInBase: whole, expectedOutBase: whole, minOutBase: whole };
    const wider = { ...facts, maxSlippageBps: bpsSchema.parse(101) };
    expect(checkFill(limitBuy, quote, wider)).toMatchObject({ error: "fill_bounds" });
    const { maxSlippageBps: _left, ...agentOwn } = facts;
    expect(checkFill(limitBuy, quote, agentOwn)).toMatchObject({ error: "fill_bounds" });
  });

  it("refuses a fill whose order expired, whatever its quote", () => {
    const quote = { amountInBase: whole, expectedOutBase: whole, minOutBase: whole };
    const late = { ...facts, nowMs: limitBuy.expiresAtMs };
    expect(checkFill(limitBuy, quote, late)).toMatchObject({ error: "order_inactive" });
  });

  it("refuses a thin pool's trigger that the quote's own price does not reach", () => {
    const quote = { amountInBase: whole, expectedOutBase: whole, minOutBase: whole };
    const below = { side: "atOrBelow", price: { numerator: 999_999n, denominator: 1n } } as const;
    expect(checkFill(limitBuy, quote, { ...facts, confirm: below })).toMatchObject({
      error: "trigger_unconfirmed",
    });
    const reached = { ...below, price: { numerator: 1_000_000n, denominator: 1n } };
    expect(checkFill(limitBuy, quote, { ...facts, confirm: reached }).ok).toBe(true);
  });

  it("prices a quote per whole token from the other side's dollars", () => {
    const amounts = { inBase: 3n * whole, outBase: 2n * whole };
    expect(quotePrice("buy", amounts, { otherUsd: dollar, tokenDecimals: 18 })).toStrictEqual({
      numerator: 3n * whole * 10n ** 18n,
      denominator: 2n * whole * 10n ** 12n,
    });
    expect(quotePrice("sell", { inBase: 0n, outBase: whole }, facts)).toBeUndefined();
  });
});

describe("a fill's size", () => {
  it("prices a size in dollars down, and refuses it without a price", () => {
    const buying = { side: "buy" as const, heldBase: 0n, keptBase: 0n, spendUsd: dollar };
    expect(fillLimitBase({ usdMicros: 25_000_000n }, buying)).toStrictEqual({
      ok: true,
      value: 25n * whole,
    });
    const { spendUsd: _left, ...unpriced } = buying;
    expect(fillLimitBase({ usdMicros: 1n }, unpriced)).toStrictEqual({
      ok: false,
      error: "no_price",
    });
  });

  it("sells no more than the wallet holds, by amount or in dollars", () => {
    const held = { side: "sell" as const, heldBase: whole, keptBase: 0n, spendUsd: dollar };
    expect(fillLimitBase({ base: 2n * whole }, held)).toStrictEqual({ ok: true, value: whole });
    expect(fillLimitBase({ usdMicros: 5_000_000n }, held)).toStrictEqual({
      ok: true,
      value: whole,
    });
  });
});
