import { describe, expect, it } from "vitest";
import { ids, refs } from "../examples/wire-values.js";
import { limitChangesSchema, limitsViewSchema } from "./limits-view.schema.js";

const view = {
  agent: ids.agent,
  perTradeUsdMicros: "100000000",
  rollingDayUsdMicros: "500000000",
  slippageRegistryBps: 100,
  slippageOtherBps: 500,
  priceImpactBps: 300,
  taxBps: 1_000,
  liquidityFloorUsdMicros: "10000000000",
  minHealthFactorBps: 15_000,
  gasReserve: { [refs.chain]: "2000000000000000" },
  venues: ["fake-swap"],
  allowTokens: [],
  denyTokens: [refs.token],
  modelBudgetUsdMicros: "3000000",
  cardTradeExpirySeconds: 60,
  cardOtherExpirySeconds: 600,
  requoteAfterSeconds: 10,
  requoteToleranceBps: 50,
  orderExpiryDays: 30,
  copyPerBuyUsdMicros: "20000000",
  copyPerLeaderDayUsdMicros: "200000000",
  changedAt: 1_760_000_000_000,
} as const;

describe("limitsViewSchema", () => {
  it("needs every setting in a view", () => {
    const { taxBps: _taxBps, ...withoutTax } = view;
    expect(limitsViewSchema.safeParse(view).success).toBe(true);
    expect(limitsViewSchema.safeParse(withoutTax).success).toBe(false);
  });
});

describe("limitChangesSchema", () => {
  it.each([
    ["no change", {}],
    ["one cap", { rollingDayUsdMicros: "1000000" }],
    ["a gas reserve per chain", { gasReserve: { "fake:1": "2000000000000000" } }],
  ] as const)("takes %s", (_name, changes) => {
    expect(limitChangesSchema.safeParse(changes).success).toBe(true);
  });

  it.each([
    ["a setting it does not know", { perDayUsd: 5 }],
    ["a cap as a number", { perTradeUsdMicros: 100 }],
    ["a health factor below 1", { minHealthFactorBps: 9_999 }],
  ] as const)("refuses %s", (_name, changes) => {
    expect(limitChangesSchema.safeParse(changes).success).toBe(false);
  });
});
