import { accountRefSchema, type RiskFlagCode } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import type { RiskFlag } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { riskVerdict, type RiskFindings, type SourceAnswer } from "./risk-verdict.js";
import type { RoundTrip } from "./round-trip.js";

const bps = (value: number) => bpsSchema.parse(value);
const clean: RoundTrip = {
  kind: "measured",
  buyTaxBps: bps(0),
  hookFeeBps: bps(0),
  transferTaxBps: bps(0),
  sellTaxBps: bps(0),
};
const deep = 50_000_000_000n;

function reported(id: string, flags: readonly RiskFlagCode[], liquidity?: bigint): SourceAnswer {
  const report = liquidity === undefined ? { flags } : { flags, liquidityUsdMicros: liquidity };
  return { id, isRequired: id === "required", outcome: "reported", report };
}

function findingsOf(changes: Partial<RiskFindings> = {}): RiskFindings {
  return {
    answers: [reported("required", [], deep), reported("optional", [])],
    roundTrip: clean,
    limits: { maxTaxBps: bps(1_000), liquidityFloorUsdMicros: 10_000_000_000n },
    checkedAtMs: 1_000,
    ...changes,
  };
}

describe("the launch window in the risk verdict", () => {
  it("passes a snipe tax at the maximum, which still counts in the buy leg's tax", () => {
    const roundTrip = { ...clean, buyTaxBps: bps(1_000) };
    expect(riskVerdict(findingsOf({ snipeTaxBps: bps(1_000), roundTrip }))).toMatchObject({
      view: { verdict: "warn", buyTaxBps: 1_000 },
    });
  });

  it("refuses a snipe tax above the maximum before the buy leg's tax it is part of", () => {
    const roundTrip = { ...clean, buyTaxBps: bps(9_700) };
    expect(riskVerdict(findingsOf({ snipeTaxBps: bps(9_700), roundTrip }))).toMatchObject({
      view: { verdict: "block" },
      refusal: "snipe_tax",
    });
  });

  it("records the launchpad's insiders on the view, and none when it names none", () => {
    const insider = accountRefSchema.parse("eip155:56:0x000000000000000000000000000000000000dEaD");
    expect(riskVerdict(findingsOf({ insiders: [insider] })).view.insiders).toStrictEqual([insider]);
    expect(riskVerdict(findingsOf({ insiders: [] })).view).not.toHaveProperty("insiders");
  });
});

// A measured round trip with a buy tax, and the share the route's pool hooks took.
const withBuyTax = (buy: number, hook = 0): RoundTrip => ({
  ...clean,
  buyTaxBps: bps(buy),
  hookFeeBps: bps(hook),
});

describe("a route's pool hook fee in the risk verdict", () => {
  it("counts the fee the quote names with the buy tax against the maximum", () => {
    const over = riskVerdict(findingsOf({ roundTrip: withBuyTax(900), hookFeeBps: bps(200) }));
    const under = riskVerdict(findingsOf({ roundTrip: withBuyTax(700), hookFeeBps: bps(200) }));
    expect(over).toMatchObject({ refusal: "high_tax", view: { buyTaxBps: 900 } });
    expect(under).toMatchObject({ view: { verdict: "warn", buyTaxBps: 700 } });
    expect(under).not.toHaveProperty("refusal");
  });

  it("counts the fee once, the quote's or the share measured going to the hooks, the higher", () => {
    const named = { hookFeeBps: bps(200) };
    const once = riskVerdict(findingsOf({ ...named, roundTrip: withBuyTax(750, 200) }));
    const measured = riskVerdict(findingsOf({ ...named, roundTrip: withBuyTax(750, 300) }));
    expect(once).not.toHaveProperty("refusal");
    expect(measured).toMatchObject({ refusal: "high_tax" });
  });

  it("passes a token with no tax of its own whose route keeps a fee under the maximum", () => {
    expect(
      riskVerdict(findingsOf({ roundTrip: withBuyTax(0, 200), hookFeeBps: bps(200) })),
    ).toMatchObject({ view: { verdict: "pass", buyTaxBps: 0 } });
  });
});

describe("risk verdict", () => {
  it("passes a token every source reports clean, with deep liquidity and no tax", () => {
    expect(riskVerdict(findingsOf())).toStrictEqual({
      view: {
        verdict: "pass",
        flags: [],
        buyTaxBps: 0,
        sellTaxBps: 0,
        liquidityUsdMicros: deep,
        onCurve: false,
        checkedAt: 1_000,
      },
    });
  });

  it.each<[string, Partial<RiskFindings>, string]>([
    ["a source's honeypot", { answers: [reported("required", ["honeypot"], deep)] }, "honeypot"],
    [
      "a source's failed sale",
      { answers: [reported("optional", ["cannot_sell"], deep)] },
      "cannot_sell",
    ],
    ["a test sale that failed", { roundTrip: { kind: "refused", leg: "sell" } }, "cannot_sell"],
    [
      "a hidden owner who can change balances",
      { answers: [reported("required", ["hidden_owner", "owner_changes_balances"], deep)] },
      "hidden_owner",
    ],
    [
      "a launch-window tax the quote names above the maximum",
      { snipeTaxBps: bps(1_001), roundTrip: { ...clean, buyTaxBps: bps(1_001) } },
      "snipe_tax",
    ],
    [
      "a sell tax above the maximum",
      { roundTrip: { ...clean, sellTaxBps: bps(1_001) } },
      "high_tax",
    ],
    [
      "a transfer tax above the maximum",
      { roundTrip: { ...clean, transferTaxBps: bps(3_000) } },
      "high_tax",
    ],
    [
      "liquidity below the floor",
      { answers: [reported("required", [], 9_999_999_999n)] },
      "low_liquidity",
    ],
    ["no pool any source knows of", { answers: [reported("required", [])] }, "low_liquidity"],
    [
      "a required source that is down",
      {
        answers: [
          { id: "required", isRequired: true, outcome: "down" },
          reported("optional", [], deep),
        ],
      },
      "sources_down",
    ],
    [
      "a required source with no answer",
      {
        answers: [
          { id: "required", isRequired: true, outcome: "not_covered" },
          reported("optional", [], deep),
        ],
      },
      "sources_down",
    ],
    ["a round trip that could not run", { roundTrip: { kind: "unavailable" } }, "sources_down"],
    ["a blacklist", { answers: [reported("required", ["blacklist"], deep)] }, "blacklisted"],
    ["a transfer that failed", { roundTrip: { kind: "refused", leg: "transfer" } }, "blacklisted"],
  ])("blocks %s", (_case, changes, reason) => {
    const verdict = riskVerdict(findingsOf(changes));
    expect([verdict.refusal, verdict.view.verdict]).toStrictEqual([reason, "block"]);
  });

  it("stores the first of spec 6's reasons when several hold", () => {
    const answers = [reported("required", ["blacklist", "honeypot"], 1n)];
    const verdict = riskVerdict(
      findingsOf({ answers, roundTrip: { kind: "refused", leg: "sell" } }),
    );
    expect(verdict.refusal).toBe("honeypot");
  });

  it("blocks a hidden owner only when the owner can also change balances", () => {
    const answers = [reported("required", ["hidden_owner"], deep)];
    const verdict = riskVerdict(findingsOf({ answers }));
    expect([verdict.refusal, verdict.view.verdict]).toStrictEqual([undefined, "warn"]);
  });

  it("passes a tax at the maximum, with a warning", () => {
    const roundTrip = { ...clean, buyTaxBps: bps(1_000) };
    expect(riskVerdict(findingsOf({ roundTrip }))).toMatchObject({
      view: { verdict: "warn", buyTaxBps: 1_000, sellTaxBps: 0 },
    });
  });

  it("reads outages of every source as sources down, never as low liquidity", () => {
    const answers: readonly SourceAnswer[] = [
      { id: "required", isRequired: true, outcome: "down" },
      { id: "optional", isRequired: false, outcome: "down" },
    ];
    expect(riskVerdict(findingsOf({ answers })).refusal).toBe("sources_down");
  });

  it("passes when only an optional source is down, and names it in the view", () => {
    const answers: readonly SourceAnswer[] = [
      reported("required", ["mintable"], deep),
      { id: "optional", isRequired: false, outcome: "down" },
    ];
    expect(riskVerdict(findingsOf({ answers }))).toMatchObject({
      view: {
        verdict: "warn",
        flags: [
          { code: "mintable", source: "required" },
          { code: "unavailable", source: "optional" },
        ],
      },
    });
  });

  it("takes the largest liquidity any source reports", () => {
    const answers = [reported("required", [], 1n), reported("optional", [], deep)];
    expect(riskVerdict(findingsOf({ answers })).view.liquidityUsdMicros).toBe(deep);
  });

  it.each<[string, RoundTrip, readonly RiskFlag[]]>([
    [
      "a transfer tax",
      { ...clean, transferTaxBps: bps(5) },
      [{ code: "transfer_tax", source: "simulation" }],
    ],
    [
      "a refused transfer",
      { kind: "refused", leg: "transfer" },
      [{ code: "transfer_blocked", source: "simulation" }],
    ],
    [
      "a refused sale",
      { kind: "refused", leg: "sell" },
      [{ code: "cannot_sell", source: "simulation" }],
    ],
    [
      "a round trip that could not run",
      { kind: "unavailable" },
      [{ code: "unavailable", source: "simulation" }],
    ],
  ])("names %s as the simulation's finding", (_case, roundTrip, flags) => {
    expect(riskVerdict(findingsOf({ roundTrip })).view.flags).toStrictEqual(flags);
  });

  it("names a source with no answer in the view", () => {
    const answers: readonly SourceAnswer[] = [
      reported("required", [], deep),
      { id: "optional", isRequired: false, outcome: "not_covered" },
    ];
    expect(riskVerdict(findingsOf({ answers })).view.flags).toStrictEqual([
      { code: "not_covered", source: "optional" },
    ]);
  });
});
