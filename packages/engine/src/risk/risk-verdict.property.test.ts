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

// Whether a leg passes the maximum, the buy with its pool fee.
const isOver = ({ buy, sale, hook, max }: Taxed): boolean => Math.max(buy + hook, sale) > max;

// Whether only the pool fee took the buy past the maximum, with the sale within it.
const isFeeOver = ({ buy, sale, hook, max }: Taxed): boolean =>
  sale <= max && buy + hook > max && hook > 0;

// The reason a tax refusal names: the pool fee alone on a token with no buy tax, both otherwise.
const feeReasonOf = (taxed: Taxed): string =>
  taxed.buy === 0 ? "high_pool_fee" : "high_tax_with_pool_fee";

describe("a tax above the maximum in the risk verdict, for any taxes, fee and maximum", () => {
  it("refuses exactly when a leg passes the maximum, the buy with its pool fee", () => {
    fc.assert(
      fc.property(taxedCases, (taxed) => {
        const { refusal } = riskVerdict(taxedOf(taxed));
        expect(refusal !== undefined).toBe(isOver(taxed));
      }),
    );
  });

  it("names the pool fee, alone or with the buy tax, only when the fee took the buy over", () => {
    fc.assert(
      fc.property(taxedCases, (taxed) => {
        const { refusal } = riskVerdict(taxedOf(taxed));
        expect(refusal === feeReasonOf(taxed)).toBe(isFeeOver(taxed));
      }),
    );
  });
});
