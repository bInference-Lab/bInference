import { protocolIdSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { type RuleFields, ruleRequestOf } from "./rule-request";

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const cake = "eip155:56/erc20:0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";
const usdt = "eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955";
const nowMs = 1_800_000_000_000;

const fields: RuleFields = {
  name: "CAKE breakout",
  side: "buy",
  sizeUnit: "usd",
  size: "20",
  worstPrice: "",
  slippage: "",
  maxFills: "",
  rate: "",
  days: "",
};

const token = { asset: cake, decimals: 18 };

describe("ruleRequestOf", () => {
  it("reads dollars as micro-dollars and leaves every empty bound to the engine", () => {
    const made = ruleRequestOf(fields, { agent, found: { token }, nowMs });
    expect(made).toStrictEqual({
      ok: true,
      request: {
        agent,
        name: "CAKE breakout",
        token: cake,
        side: "buy",
        size: { usdMicros: 20_000_000n },
      },
    });
  });

  it("reads an amount in the decimals of what it counts, and every bound as typed", () => {
    const spend = { asset: usdt, decimals: 18 };
    const typed = {
      ...fields,
      sizeUnit: "amount",
      size: "0.5",
      worstPrice: "2.75",
      slippage: "0.5",
      maxFills: "3",
      rate: "5",
      days: "7",
    } as const;
    const made = ruleRequestOf(typed, { agent, found: { token, spend, counted: spend }, nowMs });
    expect(made).toMatchObject({
      ok: true,
      request: {
        spend: usdt,
        size: { base: 5n * 10n ** 17n },
        worstPrice: 2_750_000n,
        maxSlippageBps: 50,
        maxFills: 3,
        ratePerMinute: 5,
        expiresAt: nowMs + 7 * 86_400_000,
      },
    });
  });

  it("reads a share of the balance in basis points", () => {
    const sale = { ...fields, side: "sell", sizeUnit: "percent", size: "25" } as const;
    const made = ruleRequestOf(sale, { agent, found: { token, counted: token }, nowMs });
    expect(made).toMatchObject({
      ok: true,
      request: { side: "sell", size: { percentBps: 2_500 } },
    });
  });

  it("names the first field it cannot read, and stores nothing", () => {
    const outcomes = [
      ruleRequestOf({ ...fields, size: "0" }, { agent, found: { token }, nowMs }),
      ruleRequestOf({ ...fields, sizeUnit: "amount" }, { agent, found: { token }, nowMs }),
      ruleRequestOf({ ...fields, worstPrice: "cheap" }, { agent, found: { token }, nowMs }),
      ruleRequestOf({ ...fields, slippage: "0.001" }, { agent, found: { token }, nowMs }),
      ruleRequestOf({ ...fields, rate: "61" }, { agent, found: { token }, nowMs }),
      ruleRequestOf({ ...fields, days: "1.5" }, { agent, found: { token }, nowMs }),
      ruleRequestOf({ ...fields, name: " " }, { agent, found: { token }, nowMs }),
    ];
    const problems = ["size", "sizeUnknown", "worstPrice", "slippage", "rate", "days", "name"];
    expect(outcomes).toStrictEqual(problems.map((problem) => ({ ok: false, problem })));
  });
});
