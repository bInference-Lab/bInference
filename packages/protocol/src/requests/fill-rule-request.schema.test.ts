import { describe, expect, it } from "vitest";
import { z } from "zod";
import { at, ids, refs } from "../examples/wire-values.js";
import {
  orderRequestSchema,
  readOrderRequestSchema,
  webhookRuleRequestSchema,
} from "./fill-rule-request.schema.js";

const bounds = {
  agent: ids.agent,
  token: refs.token,
  side: "buy",
  size: { usdMicros: "20000000" },
  worstPrice: "1100000",
  maxSlippageBps: 100,
  expiresAt: at,
  maxFills: 2,
} as const;

const orders = [
  ["limit", { ...bounds, kind: "limit", trigger: { price: "1000000", direction: "below" } }],
  ["takeProfit", { ...bounds, kind: "takeProfit", trigger: { price: "2000000" } }],
  ["stopLoss", { ...bounds, kind: "stopLoss", trigger: { price: "500000" } }],
  ["trailing", { ...bounds, kind: "trailing", trigger: { distanceBps: 800 } }],
  ["dca", { ...bounds, kind: "dca", trigger: { cron: "0 9 * * *", timezone: "UTC", count: 10 } }],
  [
    "copy",
    {
      ...bounds,
      kind: "copy",
      trigger: { leader: refs.account, perBuyUsdMicros: "20000000", dailyUsdMicros: "200000000" },
    },
  ],
] as const;

describe("orderRequestSchema", () => {
  it.each(orders)("decodes a %s order and encodes it back unchanged", (_name, order) => {
    expect(z.encode(orderRequestSchema, z.decode(orderRequestSchema, order))).toStrictEqual(order);
  });

  it.each([
    ["a trigger of another kind", { ...bounds, kind: "limit", trigger: { distanceBps: 800 } }],
    [
      "a size in two units",
      { ...bounds, kind: "stopLoss", size: { usdMicros: "1", base: "1" }, trigger: { price: "1" } },
    ],
    ["a price as a number", { ...bounds, kind: "takeProfit", trigger: { price: 2 } }],
    ["no fills allowed", { ...bounds, kind: "trailing", maxFills: 0, trigger: { distanceBps: 1 } }],
    ["an unknown field", { ...bounds, kind: "trailing", trigger: { distanceBps: 1 }, note: "x" }],
  ] as const)("refuses %s", (_name, order) => {
    expect(orderRequestSchema.safeParse(order).success).toBe(false);
  });

  it("reads a stored order with a field a newer engine adds, and drops the field", () => {
    const stored = { ...orders[3][1], note: "x" };
    expect(readOrderRequestSchema.parse(stored)).not.toHaveProperty("note");
  });
});

describe("webhookRuleRequestSchema", () => {
  it("decodes a rule and encodes it back unchanged", () => {
    const rule = { ...bounds, name: "breakout" };
    expect(
      z.encode(webhookRuleRequestSchema, z.decode(webhookRuleRequestSchema, rule)),
    ).toStrictEqual(rule);
  });

  it("refuses a rule without a name", () => {
    expect(webhookRuleRequestSchema.safeParse(bounds).success).toBe(false);
  });
});
