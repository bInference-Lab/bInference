import type { RiskFlagCode } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { riskVerdict, type RiskFindings, type SourceAnswer } from "./risk-verdict.js";

const bps = (value: number) => bpsSchema.parse(value);
const taxes = fc.integer({ min: 0, max: 10_000 });

// The one required source's report, deep and with the given flags.
function answerOf(flags: readonly RiskFlagCode[]): SourceAnswer {
  const report = { flags, liquidityUsdMicros: 50_000_000_000n };
  return { id: "required", isRequired: true, outcome: "reported", report };
}

// A buy whose quote names `snipe` as its launch-window tax, which the round trip also measured on
// the buy leg, as it does on a launchpad's curve.
function findingsOf(snipe: number, max: number, flags: readonly RiskFlagCode[] = []): RiskFindings {
  return {
    answers: [answerOf(flags)],
    roundTrip: {
      kind: "measured",
      buyTaxBps: bps(snipe),
      hookFeeBps: bps(0),
      transferTaxBps: bps(0),
      sellTaxBps: bps(0),
    },
    limits: { maxTaxBps: bps(max), liquidityFloorUsdMicros: 10_000_000_000n },
    checkedAtMs: 1_000,
    snipeTaxBps: bps(snipe),
  };
}

describe("the launch window in the risk verdict, for any snipe tax and maximum", () => {
  it("blocks the buy as snipe_tax exactly when the snipe tax tops the maximum", () => {
    fc.assert(
      fc.property(taxes, taxes, (snipe, max) => {
        const assessment = riskVerdict(findingsOf(snipe, max));
        expect(assessment.refusal === "snipe_tax").toBe(snipe > max);
        expect(assessment.refusal === undefined).toBe(snipe <= max);
        expect(assessment.view.verdict === "block").toBe(snipe > max);
      }),
    );
  });

  it("keeps a harder finding's reason before the snipe tax", () => {
    fc.assert(
      fc.property(taxes, taxes, (snipe, max) => {
        expect(riskVerdict(findingsOf(snipe, max, ["honeypot"])).refusal).toBe("honeypot");
      }),
    );
  });
});

/** A buy's and a sale's tax, the share the route's pool hooks took, and the maximum tax. */
interface Taxed {
  readonly buy: number;
  readonly sale: number;
  readonly hook: number;
  readonly max: number;
}

const taxedCases = fc.record({
  buy: taxes,
  sale: taxes,
  hook: fc.integer({ min: 0, max: 1_000 }),
  max: taxes,
});

// A clean token's round trip with the case's taxes and pool fee, against its maximum tax.
function taxedOf({ buy, sale, hook, max }: Taxed): RiskFindings {
  return {
    answers: [answerOf([])],
    roundTrip: {
      kind: "measured",
      buyTaxBps: bps(buy),
      hookFeeBps: bps(hook),
      transferTaxBps: bps(0),
      sellTaxBps: bps(sale),
    },
    limits: { maxTaxBps: bps(max), liquidityFloorUsdMicros: 10_000_000_000n },
    checkedAtMs: 1_000,
  };
}

// The reason decisions 0216 and 0219 name, read from their words leg by leg: a leg whose own tax
// is over the maximum is `high_tax`; else a buy over it only with its pool fee names the fee, alone
// on a token with no buy tax, with the buy tax otherwise; else nothing is refused.
function reasonOf({ buy, sale, hook, max }: Taxed): string | undefined {
  const legs: readonly { readonly isOver: boolean; readonly reason: string }[] = [
    { isOver: buy > max || sale > max, reason: "high_tax" },
    { isOver: buy === 0 && hook > max, reason: "high_pool_fee" },
    { isOver: buy + hook > max, reason: "high_tax_with_pool_fee" },
  ];
  return legs.find((leg) => leg.isOver)?.reason;
}

describe("a tax above the maximum in the risk verdict, for any taxes, fee and maximum", () => {
  it("names the reason the decisions' words give, or refuses nothing", () => {
    fc.assert(
      fc.property(taxedCases, (taxed) => {
        expect(riskVerdict(taxedOf(taxed)).refusal).toBe(reasonOf(taxed));
      }),
    );
  });

  it("names the token's tax whenever a buy's own tax alone passes the maximum", () => {
    const buyOver = taxedCases.filter(({ buy, max }) => buy > max);
    fc.assert(
      fc.property(buyOver, (taxed) => {
        expect(riskVerdict(taxedOf(taxed)).refusal).toBe("high_tax");
      }),
    );
  });
});
